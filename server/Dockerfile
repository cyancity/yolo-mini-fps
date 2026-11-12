# 零号码头排行榜服务。零依赖，不需要 npm install。
FROM node:26-alpine

ENV HOST=0.0.0.0 \
    PORT=8823 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json *.js ./

# 命名卷第一次挂上来时会继承这个目录的属主，非 root 的 node 用户才写得进去
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8823

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8823/health || exit 1

CMD ["node", "board.js"]
