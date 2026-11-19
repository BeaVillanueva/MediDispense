# MediDispense PHP API (Apache) — also used by the alert-worker and reference-sync services.
FROM php:8.2-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 && printf 'date.timezone=Asia/Manila\nexpose_php=Off\nlog_errors=On\nerror_log=/proc/self/fd/2\ndisplay_errors=Off\n' > /usr/local/etc/php/conf.d/medidispense.ini

COPY --from=composer:2.8.3 /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1

WORKDIR /var/www/html
COPY backend/composer.json backend/composer.lock backend/
RUN cd backend && composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts --no-autoloader

COPY backend/ backend/
RUN cd backend && composer dump-autoload --no-dev --classmap-authoritative \
 && rm -f public/index-before-rbac.php \
 && rm -f config/local.php config/smtp.local.php config/payment-demo.local.php config/coin-review.local.php \
 && rm -rf tests

COPY deploy/php/apache-site.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/php/entrypoint.sh /usr/local/bin/medidispense-entrypoint
RUN chmod +x /usr/local/bin/medidispense-entrypoint \
 && mkdir -p backend/public/manus-storage/profile-photos \
 && chown -R www-data:www-data backend/public/manus-storage

ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["medidispense-entrypoint"]
CMD ["apache2-foreground"]
