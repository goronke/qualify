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

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});