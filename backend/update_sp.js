const { Client } = require('pg');
const client = new Client({ user: 'postgres', password: '.Sera123', host: '10.168.100.59', port: 5432, database: 'manager' });

const query = `
CREATE OR REPLACE FUNCTION app.sp_verificar_accion_ticket(p_usuario_id integer, p_ticket_id integer, p_accion character varying)
 RETURNS TABLE(permitido boolean, motivo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
    v_rol_nivel      SMALLINT;
    v_activo         BOOLEAN;
    v_bloqueado      BOOLEAN;
    v_empresa_user   INTEGER;
    v_empresa_ticket INTEGER;
    v_creador_id     INTEGER;
    v_estado_ticket  app.ticket_estado_val;
BEGIN
    SELECT r.nivel, u.activo, u.bloqueado, u.empresa_id
      INTO v_rol_nivel, v_activo, v_bloqueado, v_empresa_user
      FROM app.users u
      JOIN app.roles r ON r.id = u.rol_id
     WHERE u.id = p_usuario_id
       AND u.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, 'Usuario no encontrado o eliminado'::TEXT;
        RETURN;
    END IF;

    IF NOT v_activo THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, 'Cuenta de usuario inactiva'::TEXT;
        RETURN;
    END IF;

    IF v_bloqueado THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, 'Usuario bloqueado temporalmente'::TEXT;
        RETURN;
    END IF;

    IF p_ticket_id IS NOT NULL THEN
        SELECT empresa_id, creado_por, estado
          INTO v_empresa_ticket, v_creador_id, v_estado_ticket
          FROM app.tickets
         WHERE id = p_ticket_id
           AND deleted_at IS NULL;

        IF NOT FOUND THEN
            RETURN QUERY SELECT FALSE::BOOLEAN, 'Ticket no encontrado o eliminado'::TEXT;
            RETURN;
        END IF;

        IF v_rol_nivel < 3 AND v_empresa_user <> v_empresa_ticket THEN
            RETURN QUERY SELECT FALSE::BOOLEAN, 'Acceso denegado: el ticket no pertenece a su empresa'::TEXT;
            RETURN;
        END IF;
    END IF;

    CASE p_accion
        WHEN 'create' THEN
            IF v_rol_nivel >= 2 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: creación autorizada'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'El rol Consulta no puede crear tickets'::TEXT;
            END IF;

        WHEN 'update' THEN
            IF v_rol_nivel = 2 THEN
                IF v_creador_id = p_usuario_id THEN
                    RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: edición propia autorizada'::TEXT;
                ELSE
                    RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo podés editar tus propios tickets'::TEXT;
                END IF;
            ELSIF v_rol_nivel >= 3 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: edición autorizada por rol'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Sin permiso para editar tickets'::TEXT;
            END IF;

        WHEN 'delete' THEN
            IF v_rol_nivel >= 4 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: eliminación autorizada'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo Admin o superior puede eliminar tickets'::TEXT;
            END IF;

        WHEN 'assign' THEN
            IF v_rol_nivel >= 3 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: asignación autorizada'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo Técnico o superior puede asignar tickets'::TEXT;
            END IF;

        WHEN 'close' THEN
            IF v_rol_nivel >= 3 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: cierre autorizado'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo Técnico o superior puede cerrar tickets'::TEXT;
            END IF;

        WHEN 'reopen' THEN
            IF v_rol_nivel >= 4 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: reapertura autorizada'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo Admin o superior puede reabrir tickets'::TEXT;
            END IF;

        WHEN 'comment_internal' THEN
            IF v_rol_nivel >= 3 THEN
                RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: nota interna autorizada'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE::BOOLEAN, 'Solo staff puede agregar notas internas'::TEXT;
            END IF;

        WHEN 'read' THEN
            RETURN QUERY SELECT TRUE::BOOLEAN, 'OK: lectura autorizada'::TEXT;

        ELSE
            RETURN QUERY SELECT FALSE::BOOLEAN, ('Acción desconocida: ' || p_accion)::TEXT;
    END CASE;
END;
$function$;
`;

client.connect()
  .then(() => client.query(query))
  .then(() => { console.log('SP updated'); client.end(); })
  .catch(e => { console.error(e); client.end(); });
