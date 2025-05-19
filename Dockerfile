FROM node:22 as dev
WORKDIR /app/general
COPY ./WinterService .
RUN npm install
EXPOSE 3000
CMD [ "npm", "start" ]