# Deploy de la intranet (Docker + GHCR)

Front y API corren en el servidor Docker como un único stack en `/opt/docker/intranet`:

```
navegador ──► :INTRANET_PORT ──► intranet-web (nginx)
                                  ├─ /              build de React (Intranet-FrontEnd)
                                  ├─ /organigrama/  CSV del organigrama (carpeta del servidor)
                                  └─ /api/*         ──► intranet-api:2223 (Intranet-API) ──► Postgres de producción
```

Cada push a `main` de **Intranet-API** o **Intranet-FrontEnd** corre su `.github/workflows/deploy.yml`:

1. **build** (en GitHub): construye la imagen y la publica en GHCR
   (`ghcr.io/escorial-saic/intranet-api` / `intranet-web`, tags `:latest` y `:<sha>`).
2. **deploy** (runner self-hosted en el servidor): `docker compose pull` + `up -d` solo de ese
   servicio. Si el contenedor nuevo no queda healthy, vuelve a levantar la imagen anterior.

El servidor no compila nada: solo baja imágenes, igual que el resto de los proyectos en `/opt/docker`.

## Archivos en el servidor

| Ruta | En git | Qué es |
|---|---|---|
| `docker-compose.yml` | sí (`deploy/docker-compose.yml`) | Lo copia el deploy de la API. No editarlo en el servidor. |
| `.env` | no | Variables del compose (`deploy/.env.example`). |
| `api.env` | no | El `.env` de la API: `DB_*`, `JWT_SECRET`, `OPENAI_*`, etc. |
| `api-files/` | no | `files/` de la API (la app escribe ahí `empleados.json`, `empleados-cap.json`). |
| `organigrama/` | no | `organigrama.csv` y `organigramaAdm.csv`. Se pueden reemplazar en caliente, sin redeploy. |

## Instalación (una sola vez)

### 1. Usuario del runner

```bash
sudo useradd -m -s /bin/bash github-runner
sudo usermod -aG docker github-runner
```

> Estar en el grupo `docker` equivale a ser root en el servidor: ese usuario solo se usa para el runner.

### 2. Carpeta del stack

```bash
sudo mkdir -p /opt/docker/intranet/api-files /opt/docker/intranet/organigrama
sudo chown -R github-runner:github-runner /opt/docker/intranet
# La API corre como el usuario "node" (uid 1000) dentro del contenedor
sudo chown -R 1000:1000 /opt/docker/intranet/api-files
```

- `api.env`: el `.env` de producción de la API. `DB_HOST` tiene que ser alcanzable desde el
  servidor y el `pg_hba.conf` de Postgres tiene que aceptar su IP. `PORT` no hace falta, lo fija el compose.
- `api-files/`: el contenido actual de `files/` del servidor viejo.
- `organigrama/`: `organigrama.csv` y `organigramaAdm.csv`.
- `.env`: copiar `deploy/.env.example` y ajustar `INTRANET_PORT` si el 80 ya está en uso.

```bash
sudo chmod 600 /opt/docker/intranet/api.env /opt/docker/intranet/.env
sudo chown github-runner:github-runner /opt/docker/intranet/api.env /opt/docker/intranet/.env
```

### 3. Runner de GitHub Actions

En GitHub: organización **ESCORIAL-SAIC** → Settings → Actions → Runners →
**New self-hosted runner** → Linux x64. Seguir los comandos de descarga como `github-runner`
y registrarlo con la etiqueta `intranet`:

```bash
sudo -iu github-runner
mkdir actions-runner && cd actions-runner
# ... curl + tar que muestra GitHub ...
./config.sh --url https://github.com/ESCORIAL-SAIC --token <TOKEN> --name <nombre-servidor> --labels intranet
exit
cd /home/github-runner/actions-runner
sudo ./svc.sh install github-runner
sudo ./svc.sh start
```

El runner tiene que aparecer **Idle** en GitHub con las etiquetas `self-hosted`, `Linux`, `X64`, `intranet`.

El job de deploy se loguea en GHCR con el token del propio workflow, así que el servidor no
necesita un token guardado. Para correr `docker compose pull` a mano hace falta
`docker login ghcr.io` con un token con `read:packages`.

### 4. Primer deploy

1. Mergear a `main` el workflow de **Intranet-API** primero: crea el `docker-compose.yml` y levanta la API.
2. Después el de **Intranet-FrontEnd**: levanta el front.

También se pueden lanzar a mano desde la pestaña **Actions** de cada repo → *Run workflow*.

## Operación

```bash
cd /opt/docker/intranet
docker compose ps                 # estado y healthcheck
docker compose logs -f api        # logs de la API
docker compose restart api        # reiniciar sin redeployar
```

Fijar una versión puntual (por ejemplo, volver atrás a un commit conocido): en `.env` poner
`API_TAG=<sha del commit>` (o `WEB_TAG`) y correr `docker compose pull api && docker compose up -d api`.
Mientras esté fijada, los deploys automáticos de ese servicio no la cambian; borrar la línea para volver a `latest`.
