CREATE DATABASE IF NOT EXISTS czone_clone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE czone_clone;

CREATE TABLE IF NOT EXISTS businesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(63) NOT NULL UNIQUE,
  owner_user_id INT NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  image VARCHAR(255),
  description TEXT,
  parent_id INT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
  show_in_icons TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY business_id_slug (business_id, slug),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_content (
  business_id INT NOT NULL,
  content_key VARCHAR(50) NOT NULL,
  value JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, content_key),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  category_id INT,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL,
  brand VARCHAR(100),
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  discount_price DECIMAL(10,2),
  stock INT NOT NULL DEFAULT 0,
  image VARCHAR(255),
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_new_arrival TINYINT(1) NOT NULL DEFAULT 0,
  is_on_sale TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY business_id_slug (business_id, slug),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  verification_token VARCHAR(255),
  saved_phone VARCHAR(30) NULL,
  saved_address VARCHAR(255) NULL,
  saved_city VARCHAR(100) NULL,
  reset_token VARCHAR(255) NULL,
  reset_token_expires DATETIME NULL,
  totp_secret VARCHAR(255) NULL,
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  totp_recovery_codes TEXT NULL,
  -- Superseded by the `sessions` table below (per-device revocation). Left in place,
  -- unused, rather than dropped — harmless, and avoids a destructive migration.
  token_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY business_id_email (business_id, email),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- One row per login. The JWT carries `session_id` (this table's id) instead of embedding
-- revocable state directly in the token, so a single device can be logged out (row revoked)
-- without touching any other device's session for the same account. A security-sensitive
-- action (password change, 2FA disable) instead revokes every row for that user_id at once.
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  product_ref VARCHAR(255) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_image VARCHAR(255),
  product_slug VARCHAR(220),
  price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_product (user_id, product_ref),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_code VARCHAR(50),
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('pending_payment','pending','confirmed','packed','shipped','out_for_delivery','delivered','returned','cancelled') DEFAULT 'pending',
  shipping_name VARCHAR(150),
  shipping_address VARCHAR(255) NOT NULL,
  shipping_city VARCHAR(100),
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150),
  notes VARCHAR(500),
  courier_name VARCHAR(100),
  tracking_number VARCHAR(100),
  payment_method VARCHAR(30),
  payment_reference VARCHAR(150),
  -- Screenshot of the customer's bank/wallet transfer, uploaded at checkout for manual
  -- payment methods — lets admin cross-check the claimed reference against actual proof
  -- instead of trusting an unverifiable typed-in transaction ID alone.
  payment_proof_image VARCHAR(255),
  -- Unused leftover from a removed gateway integration. Left in place rather than dropped.
  safepay_token VARCHAR(255),
  delivered_at DATETIME NULL,
  review_reminder_sent_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_orders_business_status_created (business_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_product (user_id, product_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_ref VARCHAR(255),
  product_name VARCHAR(255) NOT NULL,
  product_image VARCHAR(255),
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  is_sale_price TINYINT(1) NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_attributes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  category_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY business_category_name (business_id, category_id, name),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_attribute_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attribute_id INT NOT NULL,
  value VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY attribute_value (attribute_id, value),
  FOREIGN KEY (attribute_id) REFERENCES category_attributes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_attribute_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  option_id INT NOT NULL,
  UNIQUE KEY product_option (product_id, option_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES category_attribute_options(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  image VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  product_id INT NOT NULL,
  user_id INT NULL,
  author_name VARCHAR(100) NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT,
  status ENUM('pending','approved') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY product_user (product_id, user_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS discount_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  code VARCHAR(50) NOT NULL,
  discount_type ENUM('percent','fixed') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  expires_at DATETIME NULL,
  reusable TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY business_code (business_id, code),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discount_code_redemptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discount_code_id INT NOT NULL,
  user_id INT NOT NULL,
  order_id INT NULL,
  -- Set to discount_code_id when the code was single-use at redemption time, else NULL.
  -- MySQL unique indexes treat NULL as distinct from every other NULL, so reusable-code
  -- redemptions (NULL) never collide while single-use ones are enforced at the DB level —
  -- a backstop in case a future code path ever bypasses the app-level FOR UPDATE lock.
  single_use_guard INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY single_use_guard_user (single_use_guard, user_id),
  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  email VARCHAR(150) NOT NULL,
  unsubscribed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY business_email (business_id, email),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Generic per-provider online payment gateway config, reusable for whichever gateway is
-- integrated (api_key/secret_key are encrypted at rest — see backend/utils/crypto.js).
CREATE TABLE IF NOT EXISTS payment_gateways (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  provider VARCHAR(30) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  sandbox TINYINT(1) NOT NULL DEFAULT 1,
  api_key VARCHAR(255),
  secret_key VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (business_id, provider),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS courier_settings (
  business_id INT NOT NULL PRIMARY KEY,
  provider VARCHAR(100) NOT NULL DEFAULT 'Leopards Courier',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  api_key VARCHAR(255),
  api_password VARCHAR(255),
  tracking_url_template VARCHAR(255) NOT NULL DEFAULT 'https://leopardscourier.com/tracking/{tracking_number}',
  sandbox TINYINT(1) NOT NULL DEFAULT 1,
  default_weight_grams INT NOT NULL DEFAULT 1000,
  origin_city VARCHAR(100) NOT NULL DEFAULT 'self',
  shipper_id VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promotional_emails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  poster_image VARCHAR(500) NULL,
  status ENUM('draft','sent') NOT NULL DEFAULT 'draft',
  sent_at DATETIME NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NULL,
  user_name VARCHAR(100) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(50) NULL,
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_business_created (business_id, created_at),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);