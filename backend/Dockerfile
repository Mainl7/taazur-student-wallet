FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Prisma validates the URL while generating its client. Compose replaces this at runtime.
ENV DATABASE_URL="mysql://placeholder:placeholder@mysql:3306/taazur"
RUN npx prisma generate
CMD ["npm", "run", "start:deploy"]
