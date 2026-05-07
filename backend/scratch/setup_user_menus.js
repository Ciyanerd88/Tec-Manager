const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  password: '.Sera123',
  host: '10.168.100.59',
  port: 5432,
  database: 'manager'
});

const queries = [
  `CREATE TABLE IF NOT EXISTS app.user_menus (
      user_id INTEGER REFERENCES app.users(id) ON DELETE CASCADE,
      menu_id INTEGER REFERENCES app.menus(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, menu_id)
  );`,
  
  `CREATE OR REPLACE FUNCTION app.sp_get_menus_usuario(p_usuario_id integer)
   RETURNS TABLE(id integer, nombre character varying, titulo character varying, icono_css character varying, ruta character varying, parent_id integer, orden smallint)
   LANGUAGE plpgsql
   STABLE SECURITY DEFINER
  AS $function$
  DECLARE
      v_rol_nivel SMALLINT;
      v_rol_id    INTEGER;
      v_activo    BOOLEAN;
  BEGIN
      SELECT r.nivel, u.rol_id, u.activo
        INTO v_rol_nivel, v_rol_id, v_activo
        FROM app.users u JOIN app.roles r ON r.id = u.rol_id
       WHERE u.id = p_usuario_id AND u.deleted_at IS NULL;

      IF NOT FOUND OR NOT v_activo THEN
          RETURN;
      END IF;

      RETURN QUERY
      SELECT
          m.id,
          m.nombre,
          m.titulo,
          m.icono_css,
          m.ruta,
          m.parent_id,
          m.orden
      FROM app.menus m
      WHERE m.activo = TRUE
        AND (
            v_rol_nivel >= 5
            OR m.permission_required IS NULL
            OR EXISTS (
                SELECT 1 FROM app.rol_menus rm
                WHERE rm.rol_id = v_rol_id AND rm.menu_id = m.id
            )
            OR EXISTS (
                SELECT 1 FROM app.user_menus um
                WHERE um.user_id = p_usuario_id AND um.menu_id = m.id
            )
        )
      ORDER BY m.parent_id NULLS FIRST, m.orden;
  END;
  $function$;`
];

async function run() {
  await client.connect();
  try {
    for (const q of queries) {
      await client.query(q);
    }
    console.log("DB updated successfully for user_menus");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
