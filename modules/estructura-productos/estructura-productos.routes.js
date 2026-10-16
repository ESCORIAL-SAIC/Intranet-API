const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

/* ESTRUCTURA DE PRODUCTOS (BOM) — migrado del BOM Viewer de AndonLineasProduccion
   (files/server.js, endpoints /bom/*). Lee el ERP en el schema public:
     producto, defprocesoproductivo, itemcomponente / v_itemcomponente, unidadmedida,
     segmento, ud_producto, v_precio, v_unidadfinanciera.
   Una "raíz" (producto terminado) es un producto que no es componente de ningún BOM activo. */

// ID del bo_place de lista de precios/costos en el ERP
const BOM_PRECIO_PLACE_ID = '{DFB5496F-297E-4644-8821-DA674A47B3EF}';

// Segmento 4 de los productos terminados que se listan en el buscador
const SEGMENTO4_PT_ID = 'feb70f5e-9ec8-4226-870b-7b7f2d51965b';

// Máximo de códigos por consulta de reutilización y cuántos se consultan en paralelo
// (el pool es compartido con el resto de la intranet: no acaparar conexiones)
const REUSE_MAX_CODIGOS = 2000;
const REUSE_BATCH = 5;

// GET /estructura-productos/productos?q=texto — autocompletar productos por código o descripción.
// Devuelve los PT raíz (sin padres) y cualquier componente que tenga estructura propia,
// con tipo 'PT' o 'COMP'. Los PT primero.
router.get("/estructura-productos/productos", requireAuth, async(req, res) => {
    const q = (req.query.q || '').trim();
    try {
        const result = await pool.query(`
            SELECT p.codigo::text AS codigo,
                   p.descripcion::text AS descripcion,
                   CASE WHEN ud.tipoproduccion = 'PT' THEN 'PT' ELSE 'COMP' END AS tipo
            FROM public.producto p
            LEFT JOIN public.segmento seg ON seg.id = p.segmento_id
            LEFT JOIN public.ud_producto ud ON ud.id = p.boextension_id
            WHERE p.activestatus = 0
              AND (
                -- PT raíz: filtro de segmento y tipoproduccion estrictos
                (ud.tipoproduccion = 'PT'
                 AND seg.segmento4_id = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM public.itemcomponente ic
                   JOIN public.defprocesoproductivo dp ON dp.componentes_id = ic.bo_place_id
                   WHERE ic.componente_id = p.id AND dp.activestatus = 0
                 ))
                OR
                -- Componente con hijos propios: sin restricción de segmento
                EXISTS (
                  SELECT 1 FROM public.defprocesoproductivo dp
                  WHERE dp.producto_id = p.id AND dp.activestatus = 0
                )
              )
              AND ($2 = '' OR LOWER(p.codigo::text) LIKE LOWER('%' || $2 || '%')
                           OR LOWER(p.descripcion::text) LIKE LOWER('%' || $2 || '%'))
            ORDER BY (ud.tipoproduccion = 'PT') DESC NULLS LAST, p.codigo
            LIMIT ${q ? 30 : 50}
        `, [SEGMENTO4_PT_ID, q]);
        res.json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los productos" });
    }
});

// GET /estructura-productos/estructura?codigo=CODIGO
// BOM completo con costo unitario y costo acumulado (cantidad propagada desde la raíz).
// El costo es el precio activo vigente hoy (desdefecha <= hoy y hastafecha vacía o >= hoy) más reciente.
router.get("/estructura-productos/estructura", requireAuth, async(req, res) => {
    const codigo = (req.query.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: "Falta parámetro codigo" });
    try {
        const result = await pool.query(`
            WITH RECURSIVE
            raiz AS (
                SELECT id, codigo
                FROM public.producto
                WHERE TRIM(codigo::text) = $1
                LIMIT 1
            ),
            est AS (
                SELECT 1                                  AS nivel,
                       d.codigo::text                     AS padre,
                       pc.id                              AS hijo_id,
                       pc.codigo                          AS hijo_codigo,
                       ARRAY[pc.codigo::text]             AS ruta,
                       ARRAY[pc.descripcion::text]        AS descs,
                       ARRAY[c.cantidad_cantidad::float8] AS cants,
                       ARRAY[un.nombre::text]             AS ums,
                       c.cantidad_cantidad::float8        AS qty_acum
                FROM raiz r
                JOIN public.defprocesoproductivo d ON d.producto_id = r.id
                                                 AND d.codigo = r.codigo
                                                 AND d.activestatus = 0
                JOIN public.v_itemcomponente c    ON c.bo_place_id = d.componentes_id
                JOIN public.producto pc           ON pc.id = c.componente_id
                JOIN public.unidadmedida un       ON un.id = c.cantidad_unidadmedida_id

                UNION ALL

                SELECT e.nivel + 1,
                       d.codigo::text,
                       pc.id,
                       pc.codigo,
                       e.ruta  || pc.codigo::text,
                       e.descs || pc.descripcion::text,
                       e.cants || c.cantidad_cantidad::float8,
                       e.ums   || un.nombre::text,
                       e.qty_acum * c.cantidad_cantidad::float8
                FROM est e
                JOIN public.defprocesoproductivo d ON d.producto_id = e.hijo_id
                                                 AND d.codigo = e.hijo_codigo
                                                 AND d.activestatus = 0
                JOIN public.itemcomponente c       ON c.bo_place_id = d.componentes_id
                JOIN public.producto pc            ON pc.id = c.componente_id
                JOIN public.unidadmedida un        ON un.id = c.cantidad_unidadmedida_id
                WHERE pc.codigo::text <> ALL (e.ruta)
            )
            SELECT
                e.nivel,
                e.padre,
                e.ruta[e.nivel]                                          AS hijo,
                e.descs[e.nivel]                                         AS descripcion,
                e.cants[e.nivel]                                         AS cantidad,
                e.ums[e.nivel]                                           AS unidadmedida,
                e.qty_acum,
                p.costo_unitario,
                ROUND((p.costo_unitario * e.cants[e.nivel])::numeric, 4) AS costo_nivel,
                ROUND((p.costo_unitario * e.qty_acum)::numeric, 4)       AS costo_acumulado,
                p.moneda
            FROM est e
            LEFT JOIN LATERAL (
                SELECT pr.inicial2_importe::numeric AS costo_unitario,
                       uf.nombre::text              AS moneda
                FROM public.v_precio pr
                LEFT JOIN public.v_unidadfinanciera uf ON pr.valor2_unidadvalorizacion_id = uf.id
                WHERE pr.referencia_id = e.hijo_id
                  AND pr.bo_place_id   = $2
                  AND pr.activestatus  = 0
                  AND LEFT(pr.desdefecha, 8)::date <= CURRENT_DATE
                  AND (pr.hastafecha IS NULL OR LEFT(pr.hastafecha, 8)::date >= CURRENT_DATE)
                ORDER BY LEFT(pr.desdefecha, 8)::date DESC NULLS LAST
                LIMIT 1
            ) p ON true
            ORDER BY e.ruta
        `, [codigo, BOM_PRECIO_PLACE_ID]);

        if (!result.rows.length) {
            return res.status(404).json({ error: "Producto no encontrado o sin estructura activa" });
        }
        const num = (v) => v != null ? parseFloat(v) : null;
        res.json(result.rows.map(row => ({
            nivel:           parseInt(row.nivel),
            padre:           row.padre,
            hijo:            row.hijo,
            descripcion:     row.descripcion || '',
            cantidad:        parseFloat(row.cantidad) || 0,
            unidadmedida:    row.unidadmedida || '',
            qty_acum:        parseFloat(row.qty_acum) || 0,
            costo_unitario:  num(row.costo_unitario),
            costo_nivel:     num(row.costo_nivel),
            costo_acumulado: num(row.costo_acumulado),
            moneda:          row.moneda || null,
        })));
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo la estructura del producto" });
    }
});

// GET /estructura-productos/donde-se-usa?codigo=CODIGO
// Productos terminados (raíces del BOM) que usan el componente, directa o indirectamente.
router.get("/estructura-productos/donde-se-usa", requireAuth, async(req, res) => {
    const codigo = (req.query.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: "Falta parámetro codigo" });
    try {
        const result = await pool.query(`
            WITH RECURSIVE
            comp AS (
                SELECT id FROM public.producto
                WHERE TRIM(codigo::text) = $1
                LIMIT 1
            ),
            inv AS (
                -- Padres directos del componente
                SELECT dp.producto_id AS prod_id, ARRAY[p.codigo::text] AS ruta
                FROM comp c
                JOIN public.itemcomponente ic       ON ic.componente_id = c.id
                JOIN public.defprocesoproductivo dp ON dp.componentes_id = ic.bo_place_id
                                                   AND dp.activestatus = 0
                JOIN public.producto p              ON p.id = dp.producto_id

                UNION ALL

                -- Padres de los padres (hacia arriba)
                SELECT dp.producto_id, i.ruta || p.codigo::text
                FROM inv i
                JOIN public.itemcomponente ic       ON ic.componente_id = i.prod_id
                JOIN public.defprocesoproductivo dp ON dp.componentes_id = ic.bo_place_id
                                                   AND dp.activestatus = 0
                JOIN public.producto p              ON p.id = dp.producto_id
                WHERE p.codigo::text <> ALL (i.ruta)   -- guarda de ciclos
            )
            SELECT DISTINCT p.codigo::text AS codigo, p.descripcion::text AS descripcion
            FROM inv i
            JOIN public.producto p ON p.id = i.prod_id
            WHERE p.activestatus = 0
              -- Solo raíces: productos que no son componente de ningún otro BOM activo
              AND NOT EXISTS (
                SELECT 1 FROM public.itemcomponente ic2
                JOIN public.defprocesoproductivo dp2 ON dp2.componentes_id = ic2.bo_place_id
                                                    AND dp2.activestatus = 0
                WHERE ic2.componente_id = i.prod_id
              )
            ORDER BY codigo
            LIMIT 100
        `, [codigo]);
        res.json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo dónde se usa el componente" });
    }
});

const SQL_REUSE_COUNT = `
    WITH RECURSIVE
    comp AS (
        SELECT id FROM public.producto WHERE TRIM(codigo::text) = $1 LIMIT 1
    ),
    inv AS (
        SELECT dp.producto_id AS prod_id, ARRAY[TRIM(p.codigo::text)] AS ruta
        FROM comp c
        JOIN public.itemcomponente ic ON ic.componente_id = c.id
        JOIN public.defprocesoproductivo dp ON dp.componentes_id = ic.bo_place_id AND dp.activestatus = 0
        JOIN public.producto p ON p.id = dp.producto_id
        UNION ALL
        SELECT dp.producto_id, i.ruta || TRIM(p.codigo::text)
        FROM inv i
        JOIN public.itemcomponente ic ON ic.componente_id = i.prod_id
        JOIN public.defprocesoproductivo dp ON dp.componentes_id = ic.bo_place_id AND dp.activestatus = 0
        JOIN public.producto p ON p.id = dp.producto_id
        WHERE TRIM(p.codigo::text) <> ALL(i.ruta)
    )
    SELECT COUNT(DISTINCT prod_id)::int AS count FROM inv
    WHERE NOT EXISTS (
        SELECT 1 FROM public.itemcomponente ic2
        JOIN public.defprocesoproductivo dp2 ON dp2.componentes_id = ic2.bo_place_id AND dp2.activestatus = 0
        WHERE ic2.componente_id = inv.prod_id
    )
`;

// POST /estructura-productos/reuse-counts  body: { codigos: [COD1, COD2, ...] }
// Cuántos productos terminados distintos usan cada componente → { COD1: n, COD2: n, ... }.
// Usado por el modo Modularidad. En el Andon era GET con los códigos en la query string; pasa a POST
// porque un BOM grande supera el largo máximo de query string de IIS.
// Una consulta por código (la CTE combinada con varios puntos de inicio perdía códigos profundos).
router.post("/estructura-productos/reuse-counts", requireAuth, async(req, res) => {
    const codigos = [...new Set((Array.isArray(req.body.codigos) ? req.body.codigos : [])
        .map(c => String(c).trim())
        .filter(Boolean))]
        .slice(0, REUSE_MAX_CODIGOS);

    if (!codigos.length) return res.status(400).json({ error: "Falta parámetro codigos" });

    try {
        const counts = {};
        for (let i = 0; i < codigos.length; i += REUSE_BATCH) {
            const lote = codigos.slice(i, i + REUSE_BATCH);
            await Promise.all(lote.map(async (codigo) => {
                const result = await pool.query(SQL_REUSE_COUNT, [codigo]);
                counts[codigo] = result.rows[0]?.count ?? 0;
            }));
        }
        res.json(counts);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo la reutilización de componentes" });
    }
});

module.exports = router;
