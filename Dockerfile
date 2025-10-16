FROM python:3.10-alpine

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies for building Python packages
RUN apk update && apk add --no-cache \
    build-base \
    postgresql-dev \
    jpeg-dev \
    zlib-dev \
    libffi-dev \
    openssl-dev \
    cargo \
    rust \
    && rm -rf /var/cache/apk/*

# Upgrade pip first
RUN pip install --upgrade pip

COPY requirements.txt /app
RUN pip install -r requirements.txt

COPY . /app
RUN python manage.py collectstatic --no-input

COPY docker-entrypoint.sh /usr/local/bin

RUN chmod 777 /usr/local/bin/docker-entrypoint.sh \
    && ln -s /usr/local/bin/docker-entrypoint.sh /

ENTRYPOINT ["docker-entrypoint.sh"]

CMD ["runprod"]
