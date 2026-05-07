require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '.Sera123',
  host: process.env.DB_HOST || '10.168.100.59',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'manager'
});

const query = `
CREATE TABLE IF NOT EXISTS app.notificaciones (
    id BIGSERIAL PRIMARY KEY,
    usuario_id_destino INTEGER NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES app.tickets(id) ON DELETE CASCADE,
    mensaje TEXT NOT NULL,
    tipo_alerta VARCHAR(50) NOT NULL, -- e.g., 'nuevo_ticket', 'nota_agregada', 'ticket_resuelto'
    leido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_usuario_leido ON app.notificaciones(usuario_id_destino, leido);
CREATE INDEX IF NOT EXISTS idx_notif_ticket ON app.notificaciones(ticket_id);

-- Opcional: trigger para actualizar la fecha (si se agrega updated_at) o limpiar viejas.
`;

async function run() {
  await client.connect();
  try {
    await client.query(query);
    console.log("Tabla de notificaciones creada con éxito.");
  } catch (err) {
    console.error('Error al crear tabla:', err);
  } finally {
    await client.end();
  }
}

run();
