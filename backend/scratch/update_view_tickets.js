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
DROP VIEW IF EXISTS app.v_tickets_completo;

CREATE VIEW app.v_tickets_completo AS
SELECT
    t.id,
    t.titulo,
    t.descripcion,
    t.estado,
    t.prioridad,
    t.empresa_id,
    e.nombre              AS empresa_nombre,
    cat.nombre            AS categoria,
    t.creado_por          AS usuario_creador_id,
    p_creador.primer_nombre || ' ' || p_creador.apellido AS creador_nombre,
    u_creador.username    AS creador_username,
    r_creador.nombre      AS creador_rol_nombre,
    r_creador.nivel       AS creador_rol_nivel,
    t.asignado_a,
    p_asig.primer_nombre  || ' ' || p_asig.apellido      AS asignado_nombre,
    u_asig.username       AS asignado_username,
    r_asig.nombre         AS asignado_rol_nombre,
    r_asig.nivel          AS asignado_rol_nivel,
    t.fecha_limite,
    t.resuelto_en,
    t.cerrado_en,
    t.created_at,
    t.updated_at,
    (SELECT COUNT(*) FROM app.ticket_comentarios tc
     WHERE tc.ticket_id = t.id AND tc.deleted_at IS NULL) AS total_comentarios,
    (SELECT COUNT(*) FROM app.ticket_adjuntos ta
     WHERE ta.ticket_id = t.id) AS total_adjuntos
FROM app.tickets t
JOIN app.empresas   e         ON e.id  = t.empresa_id
LEFT JOIN app.categorias cat  ON cat.id = t.categoria_id
JOIN app.users      u_creador ON u_creador.id = t.creado_por
JOIN app.persons    p_creador ON p_creador.id = u_creador.persona_id
JOIN app.roles      r_creador ON r_creador.id = u_creador.rol_id
LEFT JOIN app.users u_asig    ON u_asig.id = t.asignado_a
LEFT JOIN app.persons p_asig  ON p_asig.id = u_asig.persona_id
LEFT JOIN app.roles      r_asig    ON r_asig.id = u_asig.rol_id
WHERE t.deleted_at IS NULL;
`;

async function run() {
  await client.connect();
  try {
    await client.query(query);
    console.log("View v_tickets_completo updated with EXACT frontend column names.");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
