FROM freeradius/freeradius-server:3.2.10
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY deploy/vps/freeradius/entrypoint.sh /usr/local/bin/gridline-radius.sh
RUN chmod +x /usr/local/bin/gridline-radius.sh
EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["/usr/local/bin/gridline-radius.sh"]
