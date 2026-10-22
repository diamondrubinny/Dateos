# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# PostgreSQL 17 + PostGIS (geo queries) + pgvector (AI matching embeddings).
FROM postgis/postgis:17-3.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
