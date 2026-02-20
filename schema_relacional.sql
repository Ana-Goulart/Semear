-- ===== TABELA EJC =====
-- Armazena as edições do EJC com número e paróquia
CREATE TABLE IF NOT EXISTS ejc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero INT NOT NULL UNIQUE,
    paroquia VARCHAR(100) NOT NULL,
    ano INT,
    descricao TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== TABELA EQUIPES =====
-- Lista de todas as possíveis equipes (global, reutilizável em todos os EJCs)
CREATE TABLE IF NOT EXISTS equipes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    descricao TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== TABELA EQUIPES_EJC =====
-- Relaciona quais equipes fazem parte de cada EJC (N:N)
-- Possibilita que diferentes EJCs tenham diferentes equipes
CREATE TABLE IF NOT EXISTS equipes_ejc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ejc_id INT NOT NULL,
    equipe_id INT NOT NULL,
    FOREIGN KEY (ejc_id) REFERENCES ejc(id) ON DELETE CASCADE,
    FOREIGN KEY (equipe_id) REFERENCES equipes(id) ON DELETE CASCADE,
    UNIQUE KEY unique_ejc_equipe (ejc_id, equipe_id)
);

-- ===== TABELA JOVENS (MODIFICADA) =====
-- Nota: numero_ejc_fez já pode existir, não será adicionada novamente

-- ===== TABELA HISTORICO_EQUIPES (MODIFICADA) =====
-- Adicionar ejc_id se não existir (para referenciar qual EJC o jovem serviu)
ALTER TABLE historico_equipes
ADD COLUMN ejc_id INT,
ADD FOREIGN KEY (ejc_id) REFERENCES ejc(id) ON DELETE CASCADE;

-- Opção B: Se quer referencia total (mais normalizado)
-- ALTER TABLE historico_equipes
-- ADD COLUMN equipe_id INT,
-- ADD FOREIGN KEY (equipe_id) REFERENCES equipes(id) ON DELETE CASCADE;

-- ===== INSERÇÕES DE EXEMPLO =====
-- EJCs



-- Equipes (fixas, globais)
INSERT INTO equipes (nome, descricao) VALUES 
('Cozinha', 'Responsável pelas refeições'),
('Ordem', 'Mantém a disciplina e organização'),
('Comunicação', 'Gerencia comunicação e mídias'),
('Saúde', 'Cuida da saúde dos participantes'),
('Logística', 'Transporte e logística geral'),
('Espiritualidade', 'Momentos religiosos e reflexivos');

-- Equipes por EJC (exemplo: todos têm as mesmas, mas poderia variar)
INSERT INTO equipes_ejc (ejc_id, equipe_id) 
SELECT ejc.id, equipes.id FROM ejc CROSS JOIN equipes;

-- ===== ALTERAÇÃO: campo para armazenar paróquia informada do cônjuge quando não há EJC vinculado =====
ALTER TABLE jovens
ADD COLUMN IF NOT EXISTS conjuge_paroquia VARCHAR(255) DEFAULT NULL;
