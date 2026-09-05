To run full migration on clean db:
    cd ~/repos/pbdb2-migrations
    dropdb   -h localhost -U postgres pbdb
    createdb -h localhost -U postgres pbdb
    node src/run-migrations.js --createdb
