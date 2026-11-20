-- Schéma de test (MariaDB) : clés composées, contraintes nommées, commentaires.
CREATE TABLE IF NOT EXISTS `author` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL COMMENT 'Nom complet',
  `email` VARCHAR(255) UNIQUE,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB COMMENT='Auteurs';

CREATE TABLE book (
  isbn CHAR(13) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  price DECIMAL(8,2) DEFAULT 0.00,
  author_id INT REFERENCES author(id),
  KEY idx_title (title),
  CONSTRAINT chk_price CHECK (price >= 0)
);

/* table d'association */
CREATE TABLE book_tag (
  isbn CHAR(13) NOT NULL,
  tag VARCHAR(40) NOT NULL,
  CONSTRAINT pk_bt PRIMARY KEY (isbn, tag),
  CONSTRAINT fk_bt_book FOREIGN KEY (isbn) REFERENCES book (isbn) ON DELETE CASCADE
);

THIS IS NOT SQL AT ALL ;

CREATE TABLE loan (id INTEGER PRIMARY KEY, isbn CHAR(13), borrowed_at DATETIME NOT NULL);
ALTER TABLE loan ADD CONSTRAINT fk_loan_book FOREIGN KEY (isbn) REFERENCES book(isbn);
