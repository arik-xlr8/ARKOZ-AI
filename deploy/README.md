# Ubuntu 24.04 üzerinde ARKOZ AI

Bu yapı Docker kullanmadan şu servisleri çalıştırır:

- Nginx: Angular arayüzünü yayınlar ve `/api` isteklerini API'ye iletir.
- Node.js: Express API'yi yalnızca yerel `3000` portunda çalıştırır.
- Python: TimesFM servisini yalnızca yerel `8000` portunda çalıştırır.
- systemd: API ile TimesFM'i açılışta başlatır ve hata durumunda yeniden çalıştırır.

Kurulum betiği GPU bulunmayan VPS için PyTorch'un CPU paketini kullanır; gereksiz CUDA paketleri kurulmaz.

## İlk kurulum

Ubuntu 24.04 VPS'e `root` ile bağlandıktan sonra:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/arik-xlr8/ARKOZ-AI.git /opt/arkoz-ai
cd /opt/arkoz-ai
bash deploy/install-ubuntu.sh
```

Gerçek Gemini anahtarını `/opt/arkoz-ai/.env` içindeki `GEMINI_API_KEY` alanına yazın ve API'yi yeniden başlatın:

```bash
chmod 600 /opt/arkoz-ai/.env
systemctl restart arkoz-api
```

İlk TimesFM başlangıcında model dosyaları indirileceği için servis birkaç dakika hazırlanabilir.

## Kontrol

```bash
systemctl status arkoz-api arkoz-forecast nginx
curl http://127.0.0.1:3000/api/health
journalctl -u arkoz-api -u arkoz-forecast -n 100 --no-pager
```

Tarayıcıdan `http://SUNUCU_IP_ADRESI` adresi açılır.

## Güncelleme

Yeni sürüm GitHub'a gönderildikten sonra:

```bash
cd /opt/arkoz-ai
bash deploy/update-ubuntu.sh
```

Alan adı bağlandıktan sonra Nginx yapılandırmasındaki `server_name _;` satırı alan adıyla değiştirilip Certbot ile HTTPS sertifikası kurulabilir.
