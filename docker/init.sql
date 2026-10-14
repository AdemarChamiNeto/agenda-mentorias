-- Simula o Neon: o dono do banco NÃO é superusuário. Senha só de desenvolvimento local.
CREATE ROLE agenda LOGIN PASSWORD 'agenda-dev';
CREATE DATABASE agenda OWNER agenda;
CREATE DATABASE agenda_test OWNER agenda;
