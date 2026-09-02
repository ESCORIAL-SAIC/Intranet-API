-- Módulo "Objetivos Anuales" — esquema de tablas nuevas
-- Ejecutar manualmente contra la base ESCORIAL (schema web) antes de habilitar los endpoints correspondientes en server.js.

CREATE TABLE web.registro_objetivo_anual (
    id                  uuid PRIMARY KEY,
    empleado_id         integer NOT NULL,   -- mismo tipo que empleado.id / evaluacion_9box.empleado_id
    anio                integer NOT NULL,
    puesto_snapshot     text,               -- nombre del puesto al momento de crear el registro
    evaluador           varchar(150),
    estado              varchar(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicado')),
    creado_por          varchar(100) NOT NULL,
    fecha_creacion      timestamp NOT NULL DEFAULT NOW(),
    fecha_actualizacion timestamp,
    fecha_publicacion   timestamp,
    puntaje_final       numeric(4,2),       -- calculado y persistido por el backend (ver calcularPuntajeFinalObjetivos en server.js)
    UNIQUE (empleado_id, anio)
);

CREATE TABLE web.objetivo_anual_pilar (
    id                      uuid PRIMARY KEY,
    registro_id             uuid NOT NULL REFERENCES web.registro_objetivo_anual(id) ON DELETE CASCADE,
    orden                   integer NOT NULL DEFAULT 0,
    nombre                  varchar(100) NOT NULL,
    descripcion             text,
    peso                    numeric(5,2) NOT NULL CHECK (peso > 0),   -- % — la suma de los pilares de un registro debe dar 100
    unidad                  varchar(20),                              -- 'pts', '%', 'M$', libre
    direccion               varchar(10) NOT NULL CHECK (direccion IN ('higher','lower')),
    umbral_score2           numeric NOT NULL,
    umbral_score3           numeric NOT NULL,
    umbral_score4           numeric NOT NULL,
    umbral_score5           numeric NOT NULL,
    resultado_real          numeric,
    puntaje                 integer CHECK (puntaje BETWEEN 1 AND 5),
    fecha_resultado_cargado timestamp
);

CREATE INDEX idx_objetivo_anual_pilar_registro ON web.objetivo_anual_pilar(registro_id);
