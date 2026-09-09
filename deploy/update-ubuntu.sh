#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/arkoz-ai}"
APP_USER="${APP_USER:-arkoz}"
APP_HOME="/var/lib/${APP_USER}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Bu betiği root olarak çalıştırın: sudo bash deploy/update-ubuntu.sh" >&2
  exit 1
fi

if [[ -n "$(runuser -u "${APP_USER}" -- git -C "${APP_DIR}" status --porcelain --untracked-files=no)" ]]; then
  echo "Sunucudaki takip edilen dosyalarda yerel değişiklik var; güncelleme durduruldu." >&2
  exit 1
fi

runuser -u "${APP_USER}" -- git -C "${APP_DIR}" pull --ff-only
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" npm ci --prefix "${APP_DIR}"
runuser -u "${APP_USER}" -- env HOME="${APP_HOME}" npm run build --prefix "${APP_DIR}"
runuser -u "${APP_USER}" -- "${APP_DIR}/.venv/bin/python" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  torch==2.14.0
runuser -u "${APP_USER}" -- "${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/forecast-service/requirements-timesfm.txt"

install -m 0644 "${APP_DIR}/deploy/arkoz-api.service" /etc/systemd/system/arkoz-api.service
install -m 0644 "${APP_DIR}/deploy/arkoz-forecast.service" /etc/systemd/system/arkoz-forecast.service
install -m 0644 "${APP_DIR}/deploy/nginx-arkoz-ai.conf" /etc/nginx/sites-available/arkoz-ai

systemctl daemon-reload
systemctl restart arkoz-forecast.service arkoz-api.service
nginx -t
systemctl reload nginx

echo "ARKOZ AI güncellendi."
