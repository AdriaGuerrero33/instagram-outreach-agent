# Instagram Outreach Agent

Agente automatizado de DMs en Instagram usando Playwright + OpenRouter (Owl Alpha).

---

## Variables de entorno

Configura estas variables en el **Railway dashboard → Variables**:

| Variable | Descripción |
|---|---|
| `INSTAGRAM_USER` | Tu usuario de Instagram |
| `INSTAGRAM_PASS` | Tu contraseña de Instagram |
| `OPENROUTER_API_KEY` | API key de OpenRouter (`sk-or-...`) |
| `LLM_MODEL` | Modelo (default: `openrouter/owl-alpha`) |
| `DAILY_LIMIT` | Máximo DMs por día (default: `20`) |
| `CRON_HOUR` | Hora de ejecución en UTC (default: `9`) |
| `CRON_MINUTE` | Minuto de ejecución (default: `30`) |
| `RUN_NOW` | `true` para ejecutar al arrancar (útil para test) |

---

## Primer deploy en Railway

```bash
# 1. Instala Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Inicializa el proyecto (desde instagram-agent/)
cd instagram-agent
railway init

# 4. Configura las variables de entorno en el dashboard
# https://railway.app → tu proyecto → Variables

# 5. Deploy
railway up
```

---

## Ver logs en Railway

```bash
railway logs
```

O en el dashboard: **tu proyecto → Deployments → View Logs**

---

## Primer login (recomendado hacerlo local)

Instagram puede pedir verificación al hacer login desde un servidor nuevo.
Para evitarlo, haz el primer login en local:

```bash
# En instagram-agent/
cp .env.example .env
# Edita .env con tus credenciales

npm install

# Edita instagram.js temporalmente: headless: false → para ver el navegador
# Añade RUN_NOW=true en .env
node index.js
```

Si Instagram pide verificación, complétala en el navegador. Al terminar,
`session.json` se genera automáticamente. Sube ese archivo al **volumen de Railway**.

---

## Volumen de Railway (persistencia de sesión)

Sin un volumen, `session.json` y `leads.json` se pierden en cada deploy.

1. Railway dashboard → tu proyecto → **Volumes** → New Volume
2. Mount path: `/app/data`
3. Actualiza las rutas en `instagram.js`:

```js
const SESSION_FILE = '/app/data/session.json';
const LEADS_FILE   = '/app/data/leads.json';
```

---

## Descargar leads.json

Con Railway CLI:

```bash
railway run cat leads.json > leads_local.json
```

O si usas volumen, conéctate por shell:

```bash
railway shell
cat /app/data/leads.json
```

---

## Estructura de leads.json

```json
[
  {
    "username": "emprendedor123",
    "name": "Juan García",
    "bio": "Fundador de startup de ecommerce",
    "message": "Hola Juan, vi que estás construyendo...",
    "timestamp": "2024-01-15T09:31:04.000Z",
    "status": "sent"
  }
]
```

---

## Notas importantes

- El agente espera **3-8 minutos aleatorios** entre cada DM para evitar detección.
- Si Instagram detecta actividad sospechosa, verás un error de verificación en los logs — detén el agente y resuelve manualmente.
- No subas `session.json` ni `.env` a Git (ya están en `.gitignore`).
