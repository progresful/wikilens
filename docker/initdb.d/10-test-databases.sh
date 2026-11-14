#!/bin/bash
# Run by the MariaDB image on first start. Adds the databases used by pytest and Playwright.
mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL || exit 1
CREATE DATABASE IF NOT EXISTS wikilens_test;
CREATE DATABASE IF NOT EXISTS wikilens_e2e;
GRANT ALL PRIVILEGES ON wikilens_test.* TO '${MARIADB_USER}'@'%';
GRANT ALL PRIVILEGES ON wikilens_e2e.* TO '${MARIADB_USER}'@'%';
SQL
