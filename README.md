# TamgaVDesktop

**TamgaVDesktop**, herhangi bir Linux sunucusuna tek komutla kurulabilen, belirlediğiniz portta `systemd` servisi olarak 7/24 çalışan, arayüzü %100 yerli web koduyla anlık çalışan ve arkasında gerçek Linux çekirdeği üzerinde **Firefox, VS Code, Antigravity** ve diğer Linux uygulamalarını çalıştırabilen hibrit bir sanal masaüstü platformudur.

## Özellikler

- **%100 Kodla Anlık Masaüstü Kabuğu:** Klasik VNC/RDP gibi bulanık tam ekran görüntü aktarımı yerine; masaüstü, ikonlar, dock, pencere çerçeveleri, Dosya Gezgini, Açık/Koyu tema geçişleri ve özel duvar kağıtları tamamen tarayıcıda 120fps yerli kodla çalışır.
- **Gerçek Linux GUI Uygulamaları (Pencere Bazlı):** Sunucuda kurulu olan gerçek **Firefox**, **VS Code**, **Antigravity**, **GIMP**, **VLC** veya herhangi bir Linux GUI uygulaması çerçevesiz olarak kendi pencere çerçevemiz içinde açılır (canlı ses, pano senkronizasyonu, dinamik boyutlandırma ve Türkçe klavye desteğiyle).
- **Gerçek Linux Terminali:** Sıfır C++ derleme gerektiren yerleşik PTY köprüsü ile `bash`/`zsh` kabuğu doğrudan sunucunuzda çalışır.
- **Tek VDS'te Bağımsız Sanal Masaüstleri:** `?desktop=<ad>` üzerinden her biri izole dosya sistemi, tema, duvar kağıdı ve uygulama profiline sahip sınırsız sanal masaüstü.
- **Animasyonlu Tema & Özel Arka Plan:** Dairesel yayılan Açık ↔ Koyu tema animasyonu, cihazdan veya sanal dosyalardan animasyonlu özel duvar kağıdı seçimi, tam ekran öneri bildirimi.
- **Tek Port + Oturum Koruması:** İmzalı `HttpOnly` oturum çerezi, parola koruması ve `systemd` servis yönetimi.

---

## Hızlı Kurulum (Ubuntu / Debian Sunucu)

```bash
# 1. Global olarak kurun
npm install -g tamga-vdesktop

# 2. Yapılandırma dosyasını oluşturun (port, parola, veri dizini)
tamga-vdesktop init

# 3. Linux GUI çalışma ortamını ve Firefox'u kurun (Ubuntu/Debian)
tamga-vdesktop setup-linux --with-firefox

# 4. 7/24 çalışan systemd servisini kurun ve başlatın
tamga-vdesktop service install
```

Ardından tarayıcınızdan `http://<SUNUCU-IP>:4800` adresine bağlanın.

---

## CLI Komutları

| Komut | Açıklama |
| --- | --- |
| `tamga-vdesktop start [--port 4800] [--config path]` | Sunucuyu başlatır |
| `tamga-vdesktop init` | Etkileşimli yapılandırma sihirbazı |
| `tamga-vdesktop setup-linux [--with-firefox] [--with-vscode]` | Gerekli Linux X11/ses bağımlılıklarını kurar |
| `tamga-vdesktop service install \| start \| stop \| restart \| status \| logs` | `systemd` servisini yönetir |
| `tamga-vdesktop passwd <yeni-parola>` | Yönetici parolasını günceller |
| `tamga-vdesktop doctor` | Sunucu, port ve GUI bağımlılıklarını teşhis eder |

---

## Yapılandırma Dosyası (`config.json`)

Varsayılan konum: `/etc/tamga-vdesktop/config.json` (root) veya `~/.config/tamga-vdesktop/config.json`.

```json
{
  "name": "TamgaVDesktop",
  "host": "0.0.0.0",
  "port": 4800,
  "dataDir": "/var/lib/tamga-vdesktop",
  "trustProxy": true,
  "auth": {
    "enabled": true,
    "username": "admin",
    "passwordHash": "scrypt:...",
    "sessionSecret": "..."
  },
  "desktop": {
    "defaultTheme": "dark",
    "defaultWallpaper": "mono-peaks",
    "allowMultiDesktop": true,
    "filesystemMode": "isolated",
    "hostRootPath": "/root"
  },
  "linuxApps": {
    "enabled": true,
    "fps": 20,
    "quality": 4,
    "audio": true,
    "allowInstall": true
  }
}
```

## Lisans

MIT © Uunan
