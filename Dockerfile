FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài đặt python/build-essential (cần thiết cho libsodium hoặc native dependencies của Discord)
RUN apt-get update || : && apt-get install python3 build-essential ffmpeg -y || :

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Mở port cho Express
EXPOSE 3000

# Khởi chạy theo npm start
CMD ["npm", "start"]
