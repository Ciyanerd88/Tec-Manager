require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

(async () => {
    try {
        await client.connect();
        await client.query('SET search_path TO app, public');

        console.log('Actualizando sp_get_menus_usuario...');
        
        await client.query(`
            CREATE OR REPLACE FUNCTION app.sp_get_menus_usuario(p_usuario_id integer)
            RETURNS TABLE(
                id integer, 
                nombre character varying, 
                titulo character varying, 
                icono_css character varying, 
                ruta character varying, 
                parent_id integer, 
                orden smallint, 
                permission_required character varying
            )
            LANGUAGE plpgsql
            STABLE SECURITY DEFINER
            AS $function$
            DECLARE
                v_rol_nivel SMALLINT;
                v_rol_id    INTEGER;
                v_activo    BOOLEAN;
                v_custom    BOOLEAN;
            BEGIN
                SELECT r.nivel, u.rol_id, u.activo, COALESCE(u.custom_navigation, FALSE)
                  INTO v_rol_nivel, v_rol_id, v_activo, v_custom
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
                    m.orden,
                    m.permission_required
                FROM app.menus m
                WHERE m.activo = TRUE
                  AND (
                      v_rol_nivel >= 5
                      OR m.permission_required IS NULL
                      OR (
                          v_custom = TRUE AND EXISTS (
                              SELECT 1 FROM app.user_menus um
                              WHERE um.user_id = p_usuario_id AND um.menu_id = m.id
                          )
                      )
                      OR (
                          v_custom = FALSE AND EXISTS (
                              SELECT 1 FROM app.rol_menus rm
                              WHERE rm.rol_id = v_rol_id AND rm.menu_id = m.id
                          )
                      )
                  )
                ORDER BY m.parent_id NULLS FIRST, m.orden;
            END;
            $function$;
        `);

        console.log('Función actualizada correctamente.');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
