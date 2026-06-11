Tempat menyimpan library JS lokal agar tidak bergantung ke CDN.

Tambahkan file berikut jika ingin pakai offline/local deployment:
- html2pdf.bundle.min.js  (https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js)
- xlsx.full.min.js        (https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js)

Jika file ada di folder ini, aplikasi akan memuat file lokal terlebih dahulu. Jika tidak ada, akan menggunakan CDN otomatis.

Catatan:
- Untuk deploy ke Vercel, letakkan file-file tersebut di `js/lib/` agar ter-serve secara statis.
- Jika ingin saya tambahkan file library ke repo (unduh dari CDN), minta saja — saya dapat mengunduh dan menyimpannya di sini.