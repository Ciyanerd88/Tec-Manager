const { Server } = require('socket.io');

let io;

module.exports = {
    init: (httpServer) => {
        io = new Server(httpServer, {
            cors: {
                origin: "*", // En producción configurar correctamente
                methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
            }
        });
        
        io.on('connection', (socket) => {
            console.log('Nuevo cliente conectado:', socket.id);

            // El cliente debe emitir 'join' con su ID de usuario al conectarse
            socket.on('join', (userId) => {
                if (userId) {
                    socket.join(`user_${userId}`);
                    console.log(`Socket ${socket.id} unido a room user_${userId}`);
                }
            });

            socket.on('disconnect', () => {
                console.log('Cliente desconectado:', socket.id);
            });
        });
        
        return io;
    },
    getIO: () => {
        if (!io) {
            throw new Error('Socket.io no está inicializado');
        }
        return io;
    }
};
