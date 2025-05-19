const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const app = express();
const port = 3000;

const PermissionRoles = {
  'Admin': 1,
  'User': 2,
  'Manager': 3,
  'Accountant': 4,
  'Coach': 5
}

const UserEndpointPerm = ['Admin', 'User'];
const AdminEndpointPerm = ['Admin'];
const ManagerEndpointPerm = ['Admin','Manager'];
const AccountantEndpointPerm = ['Admin','Accountant'];
const CoachEndpointPerm = ['Admin','Coach'];

const pool = new Pool({
  user: 'postgres',
  host: 'database',
  database: 'auth_service_db',
  password: 'postgres',
  port: 5432,
});

const getPayloadToken = ({ cookies }) => {
  const token = cookies?.['access-token'];
  return jwt.decode(Array.isArray(token) ? token[0] : token);
}

const permissionMiddleware = (permRoles, request, response) => {
  const payload = getPayloadToken(request);
  if(permRoles.some((role) => payload?.role === PermissionRoles[role])) {
    return null;
  }
  return res.status(403).json({ error: 'Недостаточно прав' })
}

app.use(express.json());

app.get('/accountant/payments', async (req, res) => {
  permissionMiddleware(AccountantEndpointPerm,req,res)
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
  permissionMiddleware(AccountantEndpointPerm,req,res)
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
  permissionMiddleware(CoachEndpointPerm,req,res)
  const coachId = getPayloadToken(req)?.id;
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
  permissionMiddleware(CoachEndpointPerm,req,res)
  const coachId = getPayloadToken(req)?.id;
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
  permissionMiddleware(ManagerEndpointPerm,req,res)
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
    permissionMiddleware(UserEndpointPerm,req,res)
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

app.get('/user/sports', async (req, res) => {
  try {
    permissionMiddleware(UserEndpointPerm,req,res)
    const query = 'SELECT id, name, image FROM kinds_of_sport';
    const result = await pool.query(query);
    res.status(200).json({
      sports: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/sections', async (req, res) => {
  permissionMiddleware(UserEndpointPerm,req,res)
  const clientId = getPayloadToken(req)?.id;
  const { sportId } = req.query;
  if (!sportId || !clientId) {
    return res.status(400).json({ error: 'sportId и clientId обязательны' });
  }
  try {
    const query = `
      SELECT
        g.id AS id,
        g.name AS name,
        c.name AS coachName,
        c.qualify AS coachQualify,
        g.min_age AS minAge,
        g.max_age AS maxAge,
        g.clients_count - COUNT(cg.id) AS spotsLeft
      FROM groups g
      JOIN kinds_of_sport kos ON kos.id = g.kind_of_sport_id
      JOIN couches c ON g.couch_id = c.id
      LEFT JOIN clients_groups cg ON g.id = cg.group_id
      JOIN (
         SELECT
             id,
             EXTRACT(YEAR FROM AGE(current_date, date_of_birth)) AS age
         FROM clients
         WHERE id = $2
      ) cl ON cl.age BETWEEN g.min_age AND g.max_age
      WHERE g.kind_of_sport_id = $1
      GROUP BY g.id, kos.name, c.name, c.qualify, g.name, g.min_age, g.max_age, g.clients_count
      HAVING g.clients_count - COUNT(cg.id) > 0;
    `;
    const result = await pool.query(query, [sportId, clientId]);
    res.status(200).json({
      groups: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/user/sections', async (req, res) => {
  permissionMiddleware(UserEndpointPerm,req,res)
  const clientId = getPayloadToken(req)?.id;
  const { groupId } = req.body;
  if (!groupId || !clientId) {
    return res.status(400).json({ error: 'groupId и clientId обязательны' });
  }
  try {
    const query = 'INSERT INTO clients_groups (client_id, group_id) VALUES ($1, $2)';
    await pool.query(query, [clientId, groupId]);
    res.status(200).json({
      message: 'Вы записались в новую секцию. Информация о расписании секции появилась у вас в календаре. При первом посещении необходимо оплатить абонемент.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/schedule', async (req, res) => {
  permissionMiddleware(UserEndpointPerm,req,res)
  const clientId = getPayloadToken(req)?.id;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId обязателен' });
  }
  try {
    const query = `
      SELECT
        g.kind_of_sport_id AS sportId,
        kos.name AS sportName,
        cl.place_id AS placeId,
        p.name AS placeName,
        cl.date_time AS "timestamp",
        cl.group_id AS groupId,
        g.name AS groupName,
        cl.duration AS duration
      FROM classes cl
      JOIN place p ON cl.place_id = p.id
      JOIN groups g ON cl.group_id = g.id
      JOIN kinds_of_sport kos ON g.kind_of_sport_id = kos.id
      JOIN clients_groups cg ON cg.group_id = g.id
      WHERE cg.client_id = $1
        AND cl.group_id IS NOT NULL
      ORDER BY cl.date_time;
    `;
    const result = await pool.query(query, [clientId]);
    res.status(200).json({
      classes: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/main', async (req, res) => {
  permissionMiddleware(UserEndpointPerm,req,res)
  const id = getPayloadToken(req)?.id;
  if (!id) {
    return res.status(400).json({ error: 'id обязателен' });
  }
  try {
    // Получаем данные пользователя
    const userQuery = 'SELECT name, phone_number as "phoneNumber", date_of_birth as "dateOfBirth", size FROM clients WHERE id = $1';
    const userResult = await pool.query(userQuery, [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const user = userResult.rows[0];

    // Получаем группы пользователя
    const groupsQuery = `
      SELECT g.id, g.name, g.min_age as "minAge", g.max_age as "maxAge", g.kind_of_sport_id as "sportId", kos.name as "sportName", g.couch_id as "coachId", c.name as "coachName", c.qualify as "coachQualify"
      FROM groups g
      JOIN clients_groups cg ON cg.group_id = g.id
      JOIN kinds_of_sport kos ON kos.id = g.kind_of_sport_id
      JOIN couches c ON c.id = g.couch_id
      WHERE cg.client_id = $1
    `;
    const groupsResult = await pool.query(groupsQuery, [id]);

    res.status(200).json({
      name: user.name,
      phoneNumber: user.phoneNumber,
      dateOfBirth: user.dateOfBirth,
      size: user.size,
      groups: groupsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/feedback', async (req, res) => {
  permissionMiddleware(UserEndpointPerm,req,res)
  try {
    const query = `
      SELECT f.id, f.name, c.id as clientId, c.name as clientName, f.created_at as created, f.comment, f.rating
      FROM feedbacks f
      JOIN clients c ON f.client_id = c.id
      WHERE f.is_visible = true
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

app.post('/auth', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password required' });
  }
  try {
    const query = 'SELECT id, name FROM clients WHERE phone_number = $1 AND password = $2';
    const { rows } = await pool.query(query, [phone, password]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.status(200).json({ id: rows[0].id, name: rows[0].name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/admin/schedule', async (req, res) => {
  permissionMiddleware(AdminEndpointPerm,req,res)
  try {
    const query = `
      SELECT
        cl.id AS "classId",
        ch.name AS "coachName",
        ks.id AS "sportId",
        ks.name AS "sportName",
        pl.id AS "placeId",
        pl.name AS "placeName",
        cl.date_time AS "timestamp",
        gr.id AS "groupId",
        gr.name AS "groupName",
        cl.duration AS "duration"
      FROM public.classes cl
      JOIN public.place pl ON cl.place_id = pl.id
      LEFT JOIN public."groups" gr ON cl.group_id = gr.id
      LEFT JOIN public.couches ch ON gr.couch_id = ch.id
      LEFT JOIN public.kinds_of_sport ks ON gr.kind_of_sport_id = ks.id
      ORDER BY cl.date_time;
    `;
    const { rows } = await pool.query(query);
    
    res.status(200).json({
      classes: rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/admin/schedule', async (req, res) => {
  permissionMiddleware(AdminEndpointPerm,req,res)
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id обязателен' });
  }

  try {
    const query = 'DELETE FROM public.classes WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Занятие не найдено' });
    }

    res.status(200).json({ 
      message: 'Занятие удалено' 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/admin/scheduleAddData', async (req, res) => {
  permissionMiddleware(AdminEndpointPerm,req,res)
  try {
    // Получаем виды спорта
    const sportsQuery = `
      SELECT 
        ks.id AS "sportId",
        ks.name AS "name"
      FROM public.kinds_of_sport ks
      ORDER BY ks.id;
    `;
    const sportsResult = await pool.query(sportsQuery);

    // Получаем тренеров
    const coachesQuery = `
      SELECT 
        ch.id AS "id",
        ch.name AS "name",
        ch.kind_of_sport_id AS "sportId"
      FROM public.couches ch
      ORDER BY ch.id;
    `;
    const coachesResult = await pool.query(coachesQuery);

    // Получаем места проведения
    const placesQuery = `
      SELECT 
        pl.id AS "id",
        pl.name AS "name"
      FROM public.place pl
      ORDER BY pl.id;
    `;
    const placesResult = await pool.query(placesQuery);

    // Получаем группы
    const groupsQuery = `
      SELECT 
        gr.id AS "id",
        gr.name AS "name",
        gr.couch_id AS "coachId",
        gr.kind_of_sport_id AS "sportId"
      FROM public."groups" gr
      ORDER BY gr.id;
    `;
    const groupsResult = await pool.query(groupsQuery);

    res.status(200).json({
      sports: sportsResult.rows,
      coaches: coachesResult.rows,
      places: placesResult.rows,
      groups: groupsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/admin/schedule', async (req, res) => {
  permissionMiddleware(AdminEndpointPerm,req,res)
  const { placeId, groupId, timestamp, duration } = req.body;

  // Проверка обязательных полей
  if (!placeId || !groupId || !timestamp || !duration) {
    return res.status(400).json({ 
      error: 'Все поля обязательны: placeId, groupId, timestamp, duration' 
    });
  }

  try {
    const query = `
      INSERT INTO public.classes (place_id, group_id, date_time, duration)
      VALUES ($1, $2, $3, $4)
    `;
    await pool.query(query, [placeId, groupId, timestamp, duration]);

    res.status(201).json({
      message: 'Новое занятие добавлено'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});