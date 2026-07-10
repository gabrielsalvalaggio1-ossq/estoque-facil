-- migracao-manual.sql
-- Migração direta dos 3 usuários que já têm dados, sem depender de script Node.
-- Reaproveita a empresa "órfã" que já foi criada numa tentativa anterior
-- (empresa-qjzxmsl6mr8dn91w, de gabrielsalvalaggio1@gmail.com) em vez de
-- deixar ela sem uso.

-- gabrielsalvalaggio1@gmail.com -> reaproveita a empresa já existente
INSERT INTO membros (empresa_id, usuario_email, papel)
VALUES ('empresa-qjzxmsl6mr8dn91w', 'gabrielsalvalaggio1@gmail.com', 'dono');

UPDATE registros
SET empresa_id = 'empresa-qjzxmsl6mr8dn91w'
WHERE usuario_email = 'gabrielsalvalaggio1@gmail.com' AND empresa_id IS NULL;

-- gabriel.salvasantos@gmail.com -> empresa nova
INSERT INTO empresas (id, nome, dono_email)
VALUES ('empresa-gsalvasantos01', 'Loja de gabriel.salvasantos@gmail.com', 'gabriel.salvasantos@gmail.com');

INSERT INTO membros (empresa_id, usuario_email, papel)
VALUES ('empresa-gsalvasantos01', 'gabriel.salvasantos@gmail.com', 'dono');

UPDATE registros
SET empresa_id = 'empresa-gsalvasantos01'
WHERE usuario_email = 'gabriel.salvasantos@gmail.com' AND empresa_id IS NULL;

-- jeferson.santos2566@gmail.com -> empresa nova
INSERT INTO empresas (id, nome, dono_email)
VALUES ('empresa-jsantos256601', 'Loja de jeferson.santos2566@gmail.com', 'jeferson.santos2566@gmail.com');

INSERT INTO membros (empresa_id, usuario_email, papel)
VALUES ('empresa-jsantos256601', 'jeferson.santos2566@gmail.com', 'dono');

UPDATE registros
SET empresa_id = 'empresa-jsantos256601'
WHERE usuario_email = 'jeferson.santos2566@gmail.com' AND empresa_id IS NULL;
