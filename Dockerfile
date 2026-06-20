FROM node:18-alpine

# Buat directory kerja di dalam container
WORKDIR /app

# Copy file package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Install dependencies hanya untuk production
RUN npm install --production

# Copy seluruh source code ke dalam container
COPY . .

# Expose port yang digunakan aplikasi
EXPOSE 8080

# Jalankan aplikasi
CMD ["npm", "start"]
