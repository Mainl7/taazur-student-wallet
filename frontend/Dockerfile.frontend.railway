FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG BACKEND_PROXY_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_PROXY_URL=$BACKEND_PROXY_URL
RUN npm run build
CMD ["npm", "run", "start"]
