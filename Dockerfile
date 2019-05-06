FROM node:dubnium AS build
WORKDIR /build
COPY package*.json ./
RUN npm i
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:dubnium-alpine AS release
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /build
COPY package.json ./
RUN npm i serve
COPY --from=build /build/build .
CMD ["node_modules/.bin/serve", "-l", "80", "-s", "."]