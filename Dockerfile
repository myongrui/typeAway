FROM nginx:1.27-alpine
COPY index.html style.css app.js /usr/share/nginx/html/
COPY audio /usr/share/nginx/html/audio/
