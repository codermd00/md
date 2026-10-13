FROM alpine:3.20
RUN apk add --no-cache curl gettext
COPY crontab.template /crontab.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
