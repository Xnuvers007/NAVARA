<div align="center">
  <img src="https://raw.githubusercontent.com/Xnuvers007/NAVARA/main/public/assets/icons/icon-512.png" width="150" alt="NAVARA Logo">
  
  # 🛡️ NAVARA
  **Navigasi Aman Berkendara**

  *Menyuluh jalan di tengah gulita, menghalau petaka dalam kebersamaan. NAVARA hadir sebagai pelita kewaspadaan, membimbing langkah Anda menuju tujuan dengan aman dan damai.*

  [![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
  [![Express.js](https://img.shields.io/badge/Express.js-4.x-lightgrey.svg)](https://expressjs.com/)
  [![SQLite](https://img.shields.io/badge/Database-SQLite-blue.svg)](https://sqlite.org/)
  [![Security](https://img.shields.io/badge/Security-A%2B-red.svg)](#-keamanan-tingkat-tinggi-enterprise-grade)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
</div>

<br/>

**NAVARA** adalah aplikasi *crowdsourcing* interaktif dan *real-time* berbasis Peta untuk memantau dan melaporkan titik rawan kejahatan jalanan (Begal, Copet, Jambret, dll) di seluruh wilayah Indonesia. Dibangun dengan keamanan tingkat *Enterprise* untuk mencegah manipulasi data.

---

## ✨ Fitur Utama

- 📍 **Peta Interaktif Real-Time**: Laporan baru langsung muncul di semua perangkat pengguna tanpa perlu *refresh* (ditenagai oleh Server-Sent Events).
- 🧩 **Laporan Rute & Titik Tunggal**: Pengguna dapat melaporkan satu titik kejadian atau menarik garis rute daerah rawan.
- 👥 **Crowd-Validation**: Sistem "Upvote/Downvote" dan kolom komentar terintegrasi untuk memverifikasi keabsahan laporan oleh warga.
- 📱 **Progressive Web App (PWA)**: Dapat diinstal langsung ke layar utama *smartphone* layaknya aplikasi *native*, mendukung mode layar penuh dan *offline-ready* UI.
- 🚦 **Clustering & Heatmap**: Visualisasi jutaan data secara dinamis tanpa membuat *browser* menjadi berat.
- 📚 **Interactive API Docs**: Dilengkapi dokumentasi OpenAPI interaktif yang tertanam di dalam web.

---

## 🔒 Keamanan Tingkat Tinggi (Enterprise-Grade)

Aplikasi ini dilindungi dari eksploitasi dan ancaman siber (OWASP Top 10):
- **DOM XSS Mitigation**: Menggunakan `DOMPurify` di *frontend* untuk menyaring injeksi script jahat.
- **CSRF / XSRF Protection**: Diperkuat dengan **Double Submit Cookie Pattern** (Token Acak) dan *Strict Origin Check*.
- **LFI & Path Traversal Prevention**: Filter Regex ketat untuk menolak manipulasi path sistem operasi.
- **Geofencing Strict Validation**: Penolakan otomatis (*400 Bad Request*) untuk koordinat di luar wilayah teritorial Indonesia.
- **RCE / Prototype Pollution**: Sanitasi rekursif di backend menolak parameter berpotensi jahat seperti `__proto__`.
- **HPP & SQLi Defense**: Menggunakan SQLite *Parameterized Queries* dan mitigasi *HTTP Parameter Pollution*.

---

## 🚀 Cara Instalasi & Penggunaan

### 1. Prasyarat Sistem
Pastikan sistem Anda sudah menginstal:
- **Node.js** (v18.0.0 atau lebih baru)
- **Git**

### 2. Instalasi
Clone repositori ini dan masuk ke dalam direktorinya:
```bash
git clone https://github.com/Xnuvers007/NAVARA.git
cd NAVARA
```

Install semua dependensi yang dibutuhkan:
```bash
npm install
```

### 3. Konfigurasi (Opsional)
Aplikasi bisa langsung berjalan tanpa konfigurasi. Namun, Anda dapat mengatur beberapa *Environment Variables* jika diperlukan (buat file `.env`):
```env
PORT=8080
ADMIN_SECRET=admin123
ALLOWED_ORIGIN=http://localhost:8080
```

### 4. Jalankan Server (Manual)
Untuk menjalankan mode produksi/pengembangan:
```bash
npm start
```
Server akan berjalan di `http://localhost:8080`.

### 🐳 5. Alternatif: Menjalankan dengan Docker (Rekomendasi)
Jika Anda tidak ingin repot menginstal Node.js secara manual, Anda bisa langsung menjalankan aplikasi ini menggunakan Docker. Ini adalah cara termudah dan paling konsisten.

**Prasyarat:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) atau Docker Engine + Docker Compose sudah terinstal di komputer Anda.

**Langkah-langkah:**
1. Clone repositori ini dan masuk ke dalam direktorinya (jika belum):
   ```bash
   git clone https://github.com/Xnuvers007/NAVARA.git
   cd NAVARA
   ```
2. Jalankan perintah Docker Compose berikut di terminal:
   ```bash
   docker-compose up -d --build
   ```
3. Docker akan otomatis membuat environment, melakukan build, dan menjalankan aplikasi di *background* (`-d`).
4. Buka browser dan akses `http://localhost:8080`.
5. Untuk melihat *live logs* dari aplikasi yang berjalan di Docker:
   ```bash
   docker-compose logs -f
   ```
6. Untuk mematikan aplikasi:
   ```bash
   docker-compose down
   ```
7. **(Opsional) Bersihkan Total (Clean Up Khusus Navara):** Jika Anda ingin menghapus *hanya* aplikasi Navara ini hingga bersih total (menghapus container, image Navara, dan volume data aplikasi ini saja tanpa mengganggu project Docker lain):
   ```bash
   docker-compose down -v --rmi local
   ```
   *(Peringatan: Perintah di atas akan menghapus semua log dan laporan yang tersimpan pada aplikasi Navara ini menjadi seperti baru!)*

   **Build Ulang Tanpa Cache:** Jika setelah dihapus Anda ingin merakit ulang (build) aplikasinya benar-benar dari awal (misal untuk memperbarui dependencies `npm install`) tanpa menggunakan sisa cache Docker, gunakan perintah ini:
   ```bash
   docker-compose build --no-cache
   docker-compose up -d
   ```

*Catatan: Selama Anda hanya menggunakan `docker-compose down`, data dan database akan otomatis tersimpan (persisten) secara lokal pada folder `db` dan `data` berkat pengaturan Docker volume, sehingga laporan tidak akan hilang saat container dimatikan.*

---

## 📖 Panduan Penggunaan Aplikasi

### 📝 Cara Membuat Laporan
1. Buka aplikasi di browser perangkat pintar atau PC Anda.
2. Klik tombol **Laporkan** bertanda segitiga di sudut kanan atas.
3. Klik titik lokasi kejadian di Peta.
4. (Opsional) Pilih mode **Rute** jika pelaku mengejar Anda di sepanjang jalan, lalu klik titik akhir rute.
5. Isi formulir jenis kejahatan, waktu, dan deskripsi kejadian.
6. Tekan **Kirim Laporan**. Titik merah seketika akan menyala di peta semua orang!

### ✅ Crowd Validation (Komentar & Voting)
- Klik salah satu pin (marker) yang ada di peta untuk melihat detail kejadian.
- Jika laporan tersebut adalah palsu (hoaks), tekan tombol **Turunkan (Downvote)**.
- Jika Anda melihat kejadian tersebut atau ingin memberikan info terbaru, tulis komentar dan ubah status menjadi **Aman** atau **Tidak Aman**.

### 🗑️ Menghapus Laporan (Admin)
Hanya *Admin* yang dapat menghapus laporan palsu/hoaks:
1. Klik marker/titik laporan di peta.
2. Klik tombol **Hapus Laporan (Admin)**.
3. Masukkan kata sandi admin (Default: `admin123`).
4. Laporan akan menghilang secara *real-time* dari perangkat semua pengguna.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, SQLite (sql.js)
- **Frontend**: Vanilla HTML/JS/CSS, Leaflet.js, SweetAlert2, DOMPurify
- **Security**: Helmet, Express Rate Limit, Custom Double-Submit CSRF, xss

---

<div align="center">
  Dibuat dengan ❤️ oleh <b>Xnuvers007</b> untuk masyarakat Indonesia yang lebih aman.
</div>
