-- Hapus transaksi dulu
DELETE FROM reports;
DELETE FROM medals;
DELETE FROM certificates;

-- Hapus enrollments dan students
DELETE FROM enrollments;
DELETE FROM students;

-- Reset sequences (optional, biar ID mulai dari 1 lagi)
ALTER SEQUENCE reports_id_seq RESTART WITH 1;
ALTER SEQUENCE medals_id_seq RESTART WITH 1;
ALTER SEQUENCE certificates_id_seq RESTART WITH 1;
ALTER SEQUENCE enrollments_id_seq RESTART WITH 1;
ALTER SEQUENCE students_id_seq RESTART WITH 1;