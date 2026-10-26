# Deploy de la intranet (Docker)

Front y API corren en el servidor Docker como un único stack en `/opt/docker/intranet`:

```
navegador ──► :INTRANET_PORT ──► web (nginx)
                                  ├─ /        build de React (Intranet-FrontEnd)
                                  └─ /api/*   ──► api:2223 (Intranet-API) ──► Postgres de producción
```

Cada push a `main` de **Intranet-API** o **Intranet-FrontEnd** dispara su workflow
`.github/workflows/deploy.yml`. Un runner self-hosted de GitHub Actions instalado en el
servidor construye la imagen ahí mismo y reinicia solo ese contenedor. Si el contenedor
nuevo no queda healthy, vuelve a levantar la imagen anterior (`:previous`).

## Archivos en el servidor

| Ruta | En git | Qué es |
|---|---|---|
| `/opt/docker/intranet/docker-compose.yml` | sí (`deploy/docker-compose.yml`) | Lo copia el deploy de la API. No editarlo en el servidor. |
| `/opt/docker/intranet/.env` | no | Variables del compose (`deploy/.env.example`). |
| `/opt/docker/intranet/api.env` | no | El `.env` de la API: `DB_*`, `JWT_SECRET`, `OPENAI_*`, etc. |
| `/opt/docker/intranet/api-files/` | no | `files/` de la API (la app escribe ahí `empleados.json`, `empleados-cap.json`). |
| `/opt/docker/intranet/web-overlay/` | no | Archivos que el build del front necesita y no están en git. El deploy del front los copia sobre el código antes de compilar, respetando la ruta. |

## Instalación (una sola vez)

### 1. Usuario del runner

```bash
sudo useradd -m -s /bin/bash github-runner
sudo usermod -aG docker github-runner
```

> Estar en el grupo `docker` equivale a ser root en el servidor: ese usuario solo se usa para el runner.

### 2. Carpeta del stack

```bash
sudo mkdir -p /opt/docker/intranet/api-files
sudo chown -R github-runner:github-runner /opt/docker/intranet
# La API corre como el usuario "node" (uid 1000) dentro del contenedor
sudo chown -R 1000:1000 /opt/docker/intranet/api-files
```

- `api.env`: copiar el `.env` de producción de la API. `DB_HOST` tiene que ser alcanzable
  desde el servidor y el `pg_hba.conf` de Postgres tiene que aceptar su IP.
  `PORT` no hace falta, lo fija el compose.
- `api-files/`: copiar el contenido actual de `files/` del servidor viejo.
- `.env`: copiar `deploy/.env.example` y ajustar `INTRANET_PORT` si el 80 ya está en uso.
- `web-overlay/`: el front importa dos CSV ignorados por git (`*.csv`); sin ellos el build falla.
  Copiar los reales con la misma ruta que tienen en el repo del front:
  ```
  web-overlay/src/components/Modules/Organigrama/organigrama.csv
  web-overlay/src/components/Modules/OrganigramaAdm/organigramaAdm.csv
  ```

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

### 4. Primer deploy

1. Mergear a `main` el workflow de **Intranet-API** primero: crea el `docker-compose.yml` y levanta `api`.
2. Después el de **Intranet-FrontEnd**: levanta `web`.

También se pueden lanzar a mano desde la pestaña **Actions** de cada repo → *Run workflow*.

## Operación

```bash
cd /opt/docker/intranet
docker compose ps                 # estado y healthcheck
docker compose logs -f api        # logs de la API
docker compose restart api        # reiniciar sin redeployar
```

Volver a la versión anterior a mano (por ejemplo, de la API):

```bash
docker tag intranet-api:previous intranet-api:latest
docker compose up -d --no-deps api
```
