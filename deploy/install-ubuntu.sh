#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/arkoz-ai}"
APP_USER="${APP_USER:-arkoz}"
APP_HOME="/var/lib/${APP_USER}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu betiği root olarak çalıştırın: sudo bash deploy/install-ubuntu.sh" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "Proje ${APP_DIR} konumunda bulunamadı." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx python3 python3-venv python3-pip build-essential libgomp1

if ! command -v node >/dev/null 2>&1 || [[ "$(node --version | cut -d. -f1 | tr -d v)" -lt 24 ]]; then
  node_setup="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/setup_24.x -o "${node_setup}"
  bash "${node_setup}"
  rm -f "${node_setup}"
  apt-get install -y nodejs
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_HOME}/huggingface"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" npm ci --prefix "${APP_DIR}"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" npm run build --prefix "${APP_DIR}"

if [[ ! -x "${APP_DIR}/.venv/bin/python" ]]; then
  runuser -u "${APP_USER}" -- python3 -m venv "${APP_DIR}/.venv"
fi
runuser -u "${APP_USER}" -- "${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
runuser -u "${APP_USER}" -- "${APP_DIR}/.venv/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.14.0
runuser -u "${APP_USER}" -- "${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/forecast-service/requirements-timesfm.txt"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
fi
chmod 600 "${APP_DIR}/.env"

install -m 0644 "${APP_DIR}/deploy/arkoz-api.service" /etc/systemd/system/arkoz-api.service
install -m 0644 "${APP_DIR}/deploy/arkoz-forecast.service" /etc/systemd/system/arkoz-forecast.service
install -m 0644 "${APP_DIR}/deploy/nginx-arkoz-ai.conf" /etc/nginx/sites-available/arkoz-ai
ln -sfn /etc/nginx/sites-available/arkoz-ai /etc/nginx/sites-enabled/arkoz-ai
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now arkoz-forecast.service arkoz-api.service
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo
echo "ARKOZ AI kuruldu. Kontrol: systemctl status arkoz-api arkoz-forecast nginx"
echo "API kontrolü: curl http://127.0.0.1:3000/api/health"
