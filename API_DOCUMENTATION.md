# 🛡️ NAVARA API Documentation

Dokumentasi ini mencakup rincian penggunaan API untuk aplikasi **NAVARA** (Navigasi Aman Berkendara). API ini sudah dilengkapi dengan mekanisme keamanan tingkat tinggi dan validasi input (Sanitization & Constraint Validation).

---

## 1. Konsep Keamanan & Validasi (Sangat Penting)

Sebelum menyimpan atau memproses data, API ini akan secara otomatis melakukan:
1. **CSRF Validation (Double Submit Cookie)**: Setiap request `POST`/`DELETE` wajib menyertakan Token dari Header `X-CSRF-Token` yang didapat dari endpoint `/api/csrf-token`.
2. **Koordinat Constraint (Geofencing)**: Titik koordinat Latitude (Garis Lintang) & Longitude (Garis Bujur) **HARUS valid** untuk wilayah Indonesia:
   - **Latitude**: Antara `-11.5` hingga `6.5`
   - **Longitude**: Antara `94.0` hingga `141.5`
   > *Jika user menginput `latitude: -9999999`, request otomatis di-reject (`400 Bad Request`) sebelum mencapai database.*
3. **Data Sanitization (XSS & NoSQLi)**: Semua input body akan melewati filter DOMPurify dan *Prototype Pollution Filter* untuk membuang tag `<script>` atau karakter berbahaya (seperti `__proto__`).

---

## 2. Endpoints

### 2.1 Get CSRF Token
Digunakan untuk mendapatkan token anti-pemalsuan sebelum melakukan *write/delete* data.
- **URL**: `/api/csrf-token`
- **Method**: `GET`
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "token": "a1b2c3d4e5f6g7h8..."
  }
  ```

### 2.2 Get All Reports
Mengambil data semua laporan kriminal secara realtime.
- **URL**: `/api/reports`
- **Method**: `GET`
- **Query Params**:
  - `limit` (int, default: 500): Batas data laporan.
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid-string",
        "category": "begal",
        "latitude": -6.200000,
        "longitude": 106.816666,
        "description": "Ada gerombolan bawa celurit",
        "waktu_kejadian": "malam",
        ...
      }
    ]
  }
  ```

### 2.3 Create New Report
Membuat laporan baru (Tunggal atau Rute).
- **URL**: `/api/reports`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `X-CSRF-Token: <token_dari_api_csrf>`
- **Body Parameters**:
  - `latitude` (Float, **Wajib**): Garis lintang awal (Range: -11.5 s/d 6.5).
  - `longitude` (Float, **Wajib**): Garis bujur awal (Range: 94.0 s/d 141.5).
  - `category` (String, **Wajib**): Jenis kejahatan (contoh: `begal`, `copet`, dll).
  - `description` (String, **Wajib**): Deksripsi (max 1000 karakter, HTML akan dibersihkan).
  - `waktu_kejadian` (String, **Wajib**): Waktu terjadinya (`dini_hari`, `pagi`, `siang`, `sore`, `malam`).
  - `lat_end` (Float, Opsional): Garis lintang akhir untuk mode Rute.
  - `lng_end` (Float, Opsional): Garis bujur akhir untuk mode Rute.
- **Response (201 Created)**:
  ```json
  { "success": true, "id": "uuid-string", "message": "Laporan berhasil ditambahkan" }
  ```

### 2.4 Add Comment / Crowd-Validation
Menambahkan pembaruan status ke suatu laporan.
- **URL**: `/api/reports/:id/comments`
- **Method**: `POST`
- **Headers**: `X-CSRF-Token`
- **Body Parameters**:
  - `comment` (String, **Wajib**): Komentar atau pembaruan.
  - `status_update` (String, Opsional): Mengubah status laporan (`aman` / `tidak_aman`).
- **Response (201 Created)**:
  ```json
  { "success": true, "message": "Komentar berhasil ditambahkan" }
  ```

### 2.5 Delete Report (Admin Only)
Menghapus laporan (Soft delete) oleh Admin.
- **URL**: `/api/reports/:id`
- **Method**: `DELETE`
- **Headers**:
  - `X-CSRF-Token`
  - `x-admin-key: <password_admin>`
- **Response (200 OK)**:
  ```json
  { "success": true, "message": "Laporan berhasil dihapus" }
  ```

---

*Setiap percobaan manipulasi nilai koordinat di luar batasan Geografis Indonesia, atau input HTML yang memiliki niat eksploitasi, akan menghasilkan Error HTTP `400 Bad Request` dengan keterangan spesifik yang di-*intercept* secara otomatis oleh lapisan validasi server.*
