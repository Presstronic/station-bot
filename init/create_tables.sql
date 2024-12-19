-- Organization Table
CREATE TABLE IF NOT EXISTS organization (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User Table
CREATE TABLE IF NOT EXISTS app_user (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    discord_oauth_token TEXT,
    primary_organization_id INT REFERENCES organization(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User-Organization Association Table (Many-to-Many)
CREATE TABLE IF NOT EXISTS user_organization (
    user_id INT REFERENCES app_user(id) ON DELETE CASCADE,
    organization_id INT REFERENCES organization(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, organization_id)
);

-- Vehicle Type Table
CREATE TABLE IF NOT EXISTS vehicle_type (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- Vehicle Table
CREATE TABLE IF NOT EXISTS vehicle (
    id SERIAL PRIMARY KEY,
    uexcorp_id UNIQUE,
    
    name VARCHAR(255),
    user_id INT REFERENCES app_user(id) ON DELETE CASCADE,
    vehicle_type_id INT REFERENCES vehicle_type(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default vehicle types
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM vehicle_type WHERE name = 'GROUND') THEN
        INSERT INTO vehicle_type (name) VALUES ('GROUND');
    END IF;

    IF NOT EXISTS (SELECT FROM vehicle_type WHERE name = 'AIR') THEN
        INSERT INTO vehicle_type (name) VALUES ('AIR');
    END IF;

    IF NOT EXISTS (SELECT FROM vehicle_type WHERE name = 'SPACE') THEN
        INSERT INTO vehicle_type (name) VALUES ('SPACE');
    END IF;

    IF NOT EXISTS (SELECT FROM vehicle_type WHERE name = 'WATER') THEN
        INSERT INTO vehicle_type (name) VALUES ('WATER');
    END IF;        
END
$$;
