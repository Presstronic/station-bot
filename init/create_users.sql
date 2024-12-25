DO
$$
BEGIN
    -- Create the user if it doesn't already exist
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'station_app_user') THEN
        CREATE USER station_app_user WITH PASSWORD 'secure_password';
    END IF;

    -- Grant appropriate permissions (CRUD)
    GRANT CONNECT ON DATABASE ${POSTGRES_DB:-default_db} TO station_app_user;
    GRANT USAGE ON SCHEMA public TO station_app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO station_app_user;
END
$$;
