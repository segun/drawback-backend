#!/bin/bash
set -e

# Re-create the app user explicitly with mysql_native_password so clients
# connecting without SSL (e.g. from the Docker host) can authenticate.
mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
    ALTER USER '${MYSQL_USER}'@'%'
        IDENTIFIED WITH mysql_native_password
        BY '${MYSQL_PASSWORD}';
    GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
    FLUSH PRIVILEGES;
EOSQL
