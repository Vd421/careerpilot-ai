-- Runs once when the Postgres container is first created.
-- Creates a second database so tests never touch dev data.
CREATE DATABASE careerpilot_test;
