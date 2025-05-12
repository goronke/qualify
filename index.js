const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const app = express();
const port = 3000;

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'qualify',
  password: '3301',
  port: 5432,
});

app.use(express.json());

app.get('/accountant/payments', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }
  try {
    const query = `
      SELECT
        p.date AS "Дата платежа",
        c.name AS "Клиент",
        c.phone_number AS "Номер телефона клиента",
        a.name AS "Название абонемента",
        at.name AS "Тип абонемента",
        at.cost AS "Сумма платежа"
      FROM public.payments p
      JOIN public.clients c ON p.client_id = c.id
      JOIN public.abonements a ON p.abonement_id = a.id
      JOIN public.abonement_types at ON a.type_id = at.id
      WHERE p.date BETWEEN $1 AND $2
      ORDER BY p.date DESC;
    `;
    const { rows } = await pool.query(query, [startDate, endDate]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Платежи');
    worksheet.columns = [
      { header: 'Дата платежа', key: 'Дата платежа', width: 20 },
      { header: 'Клиент', key: 'Клиент', width: 20 },
      { header: 'Номер телефона клиента', key: 'Номер телефона клиента', width: 20 },
      { header: 'Название абонемента', key: 'Название абонемента', width: 20 },
      { header: 'Тип абонемента', key: 'Тип абонемента', width: 20 },
      { header: 'Сумма платежа', key: 'Сумма платежа', width: 15 },
    ];
    rows.forEach(row => worksheet.addRow(row));

    // Генерируем буфер и кодируем в base64
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const fileName = `Платежи ${startDate} - ${endDate}.xlsx`;

    res.status(200).json({
      fileName,
      fileData: base64
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/accountant/salary', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }
  try {
    const query = `
 SELECT
  c.name AS "Тренер",
  cs.rank AS "Квалификация",
  cs.class_cost AS "Стоимость одного занятия",
  COUNT(cl.id) AS "Количество занятий за выбранный период",
  COUNT(cl.id) * cs.class_cost AS "К выплате на руки",
  ROUND(COUNT(cl.id) * cs.class_cost * 1.149425, 2) AS "К выплате в ГРОСС"
FROM public.classes cl
JOIN public."groups" g ON cl.group_id = g.id
JOIN public.couches c ON g.couch_id = c.id
JOIN public.coaches_salary cs ON c.salary_id = cs.id
  AND cl.date_time BETWEEN $1 AND $2
GROUP BY c.id, c.name, cs.rank, cs.class_cost
ORDER BY "К выплате в ГРОСС" DESC;
    `;
    const { rows } = await pool.query(query, [startDate, endDate]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Зарплаты');
    worksheet.columns = [
      { header: 'Тренер', key: 'Тренер', width: 20 },
      { header: 'Квалификация', key: 'Квалификация', width: 20 },
      { header: 'Стоимость одного занятия', key: 'Стоимость одного занятия', width: 20 },
      { header: 'Количество занятий за выбранный период', key: 'Количество занятий за выбранный период', width: 25 },
      { header: 'К выплате на руки', key: 'К выплате на руки', width: 20 },
      { header: 'К выплате в ГРОСС', key: 'К выплате в ГРОСС', width: 20 },
    ];
    rows.forEach(row => worksheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const fileName = `Тренерские зарплаты ${startDate} - ${endDate}.xlsx`;

    res.status(200).json({
      fileName,
      fileData: base64
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/coach/main', async (req, res) => {
  const coachId = req.query.id;
  if (!coachId) {
    return res.status(400).json({ error: 'id is required' });
  }
  try {
    // Получаем данные тренера
    const coachQuery = `
      SELECT c.name, c.qualify, c.phone_number, kos.name as kind_of_sport
      FROM couches c
      JOIN kinds_of_sport kos ON kos.id = c.kind_of_sport_id
      WHERE c.id = $1
    `;
    const coachResult = await pool.query(coachQuery, [coachId]);
    if (coachResult.rows.length === 0) {
      return res.status(404).json({ error: 'Coach not found' });
    }
    const coach = coachResult.rows[0];

    // Получаем группы тренера
    const groupsQuery = `
      SELECT id, name, min_age, max_age
      FROM groups
      WHERE couch_id = $1
    `;
    const groupsResult = await pool.query(groupsQuery, [coachId]);
    const groups = await Promise.all(groupsResult.rows.map(async group => {
      // Получаем клиентов группы
      const clientsQuery = `
        SELECT c.name
        FROM clients c
        JOIN clients_groups cg ON c.id = cg.client_id
        WHERE cg.group_id = $1
      `;
      const clientsResult = await pool.query(clientsQuery, [group.id]);
      return {
        groupId: group.id,
        groupName: group.name,
        minAge: group.min_age,
        maxAge: group.max_age,
        clients: clientsResult.rows.map(r => r.name)
      };
    }));

    res.status(200).json({
      coachName: coach.name,
      coachQualify: coach.qualify,
      coachPhoneNumber: coach.phone_number,
      kindOfSport: coach.kind_of_sport,
      groups
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/coach/schedule', async (req, res) => {
  const coachId = req.query.id;
  if (!coachId) {
    return res.status(400).json({ error: 'id is required' });
  }
  try {
    // Получаем имя тренера
    const coachQuery = 'SELECT name FROM couches WHERE id = $1';
    const coachResult = await pool.query(coachQuery, [coachId]);
    if (coachResult.rows.length === 0) {
      return res.status(404).json({ error: 'Coach not found' });
    }
    const coachName = coachResult.rows[0].name;

    // Получаем расписание занятий
    const classesQuery = `
      SELECT
        kos.id as sportId,
        kos.name as sportName,
        p.id as placeId,
        p.name as placeName,
        cl.date_time as "timestamp",
        g.id as groupId,
        g.name as groupName,
        cl.duration as duration
      FROM classes cl
      JOIN groups g ON g.id = cl.group_id
      JOIN place p ON p.id = cl.place_id
      JOIN kinds_of_sport kos ON g.kind_of_sport_id = kos.id
      WHERE g.couch_id = $1
    `;
    const classesResult = await pool.query(classesQuery, [coachId]);

    res.status(200).json({
      coachName,
      classes: classesResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/manager/article', async (req, res) => {
  try {
    const query = 'SELECT id, name, created, description, image FROM promo';
    const result = await pool.query(query);
    res.status(200).json({
      articles: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/manager/article', async (req, res) => {
  const { name, created, description, image } = req.body;
  if (!name || !created || !description || !image) {
    return res.status(400).json({ error: 'Все поля обязательны: name, created, description, image' });
  }
  try {
    const query = `
      INSERT INTO promo ("name", created, description, image)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `;
    const result = await pool.query(query, [name, created, description, image]);
    res.status(201).json({
      message: 'Статья создана и опубликована!',
      id: result.rows[0].id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/manager/article', async (req, res) => {
  const { id, name, created, description, image } = req.body;
  if (!id || !name || !created || !description || !image) {
    return res.status(400).json({ error: 'Все поля обязательны: id, name, created, description, image' });
  }
  try {
    const query = `
      UPDATE promo
      SET "name" = $1, created = $2, description = $3, image = $4
      WHERE id = $5
    `;
    const result = await pool.query(query, [name, created, description, image, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    res.status(200).json({ message: 'Статья изменена' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/manager/article', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id обязателен' });
  }
  try {
    const query = 'DELETE FROM promo WHERE id = $1';
    const result = await pool.query(query, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Статья не найдена' });
    }
    res.status(200).json({ message: 'Статья удалена' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/manager/feedback', async (req, res) => {
  try {
    const query = `
      SELECT f.id, f.name, c.id as clientId, c.name as clientName, f.created_at as created, f.comment, f.rating, f.is_visible as isVisible
      FROM feedbacks f
      JOIN clients c ON f.client_id = c.id
    `;
    const result = await pool.query(query);
    res.status(200).json({
      feedbacks: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/manager/feedback', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id обязателен' });
  }
  try {
    const query = 'UPDATE feedbacks SET is_visible = true WHERE id = $1';
    const result = await pool.query(query, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }
    res.status(200).json({ message: 'Отзыв опубликован' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/manager/feedback', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id обязателен' });
  }
  try {
    const query = 'DELETE FROM feedbacks WHERE id = $1';
    const result = await pool.query(query, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }
    res.status(200).json({ message: 'Отзыв удален' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/article', async (req, res) => {
  try {
    const query = 'SELECT id, name, created, description, image FROM promo';
    const result = await pool.query(query);
    res.status(200).json({
      articles: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});