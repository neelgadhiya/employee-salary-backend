const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/employee_salary';

// MongoDB Schemas
const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, maxlength: 50 },
  hours: { type: Number, required: true },
  hoursHistory: [{ hours: Number, effectiveDate: String }],
});
const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, maxlength: 50 },
  baseSalary: { type: Number, required: true },
  startDate: { type: String, required: true },
  endDate: { type: String, default: null },
  department: { type: String, required: true },
  salaryHistory: [{ salary: Number, effectiveDate: String }],
  entries: [{ id: Number, date: String, hours: Number, pay: Number, day: String, workType: String, startTime: String, endTime: String, hoursWorked: Number }],
});
const holidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
});

const Department = mongoose.model('Department', departmentSchema);
const Employee = mongoose.model('Employee', employeeSchema);
const Holiday = mongoose.model('Holiday', holidaySchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Utility Functions
function getWorkingDaysInMonth(year, month, holidays) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  const regularDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
    if (holidays.some(h => h.date === dateStr)) continue;
    const date = new Date(dateStr);
    const dayOfWeek = date.toLocaleString('en-US', { weekday: 'long' });
    if (regularDays.includes(dayOfWeek)) workingDays++;
  }
  return workingDays;
}

async function recalculateEmployeeEntries(employee, department, holidays) {
  const entries = [];
  const regularDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDate = new Date();
  const startDate = new Date(employee.startDate);
  const endDate = employee.endDate ? new Date(employee.endDate) : currentDate;
  let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  let entryId = employee.entries.length ? Math.max(...employee.entries.map(e => e.id)) + 1 : 0;

  while (current <= endDate && current <= currentDate) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lastDayToCalculate = (current.getFullYear() === currentDate.getFullYear() && current.getMonth() === currentDate.getMonth()) ? currentDate.getDate() : daysInMonth;

    const salary = employee.salaryHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
      .find(h => new Date(h.effectiveDate) <= new Date(`${year}-${(month + 1).toString().padStart(2, '0')}-01`))?.salary || employee.baseSalary;
    const deptHours = department.hoursHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
      .find(h => new Date(h.effectiveDate) <= new Date(`${year}-${(month + 1).toString().padStart(2, '0')}-01`))?.hours || department.hours;
    const workingDays = getWorkingDaysInMonth(year, month, holidays);
    const hourlyRate = salary / (deptHours * workingDays);

    for (let i = 1; i <= lastDayToCalculate; i++) {
      const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
      if (holidays.some(h => h.date === dateStr)) continue;
      const date = new Date(dateStr);
      const dayOfWeek = date.toLocaleString('en-US', { weekday: 'long' });
      if (!regularDays.includes(dayOfWeek) || date < startDate) continue;

      const existingEntry = employee.entries.find(e => e.date === dateStr);
      if (existingEntry) {
        let hoursWorked;
        let workType = existingEntry.workType;
        let startTime = existingEntry.startTime || '';
        let endTime = existingEntry.endTime || '';
        let hoursInput = existingEntry.hoursWorked || 0;

        if (existingEntry.workType === 'FULL_DAY') {
          hoursWorked = deptHours;
        } else if (existingEntry.workType === 'HALF_DAY') {
          hoursWorked = deptHours / 2;
        } else if (existingEntry.workType === 'CUSTOM') {
          const [startHours, startMinutes] = existingEntry.startTime.split(':').map(Number);
          const [endHours, endMinutes] = existingEntry.endTime.split(':').map(Number);
          const start = new Date(0, 0, 0, startHours, startMinutes);
          const end = new Date(0, 0, 0, endHours, endMinutes);
          hoursWorked = (end - start) / (1000 * 60 * 60);
          workType = `${existingEntry.startTime}-${existingEntry.endTime}`;
        } else if (existingEntry.workType === 'CUSTOM_HOURS') {
          hoursWorked = existingEntry.hoursWorked || 0;
          workType = `HOURS_${hoursWorked}`;
        } else {
          hoursWorked = 0;
        }
        entries.push({
          id: existingEntry.id,
          date: dateStr,
          hours: hoursWorked,
          pay: hoursWorked * hourlyRate,
          day: dayOfWeek,
          workType,
          startTime,
          endTime,
          hoursWorked: hoursInput,
        });
      } else {
        const hoursWorked = deptHours;
        entries.push({
          id: entryId++,
          date: dateStr,
          hours: hoursWorked,
          pay: hoursWorked * hourlyRate,
          day: dayOfWeek,
          workType: 'FULL_DAY',
          startTime: '',
          endTime: '',
          hoursWorked: 0,
        });
      }
    }
    current.setMonth(current.getMonth() + 1);
  }
  return entries;
}

// API Endpoints
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await Department.find();
    res.json(departments);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching departments' });
  }
});

app.post('/api/departments', async (req, res) => {
  const { name, hours } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!name || !hours || hours < 1 || hours > 24 || name.length > 50) {
    return res.status(400).json({ error: 'Invalid department data' });
  }
  try {
    const existingDept = await Department.findOne({ name });
    if (existingDept) return res.status(400).json({ error: 'Department already exists' });
    const department = new Department({
      name,
      hours,
      hoursHistory: [{ hours, effectiveDate: currentDate }],
    });
    await department.save();
    res.status(201).json(department);
  } catch (error) {
    res.status(500).json({ error: 'Server error creating department' });
  }
});

app.delete('/api/departments/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const employees = await Employee.find({ department: name });
    if (employees.length > 0) return res.status(400).json({ error: 'Cannot delete department with assigned employees' });
    await Department.deleteOne({ name });
    res.json({ message: 'Department deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting department' });
  }
});

app.put('/api/departments/:name/hours', async (req, res) => {
  const { name } = req.params;
  const { hours, effectiveDate } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!hours || hours < 1 || hours > 24 || !effectiveDate || new Date(effectiveDate) > new Date(currentDate)) {
    return res.status(400).json({ error: 'Invalid hours or effective date' });
  }
  try {
    const department = await Department.findOne({ name });
    if (!department) return res.status(404).json({ error: 'Department not found' });
    if (department.hours === hours) return res.status(400).json({ error: 'New hours must be different from current hours' });
    department.hours = hours;
    department.hoursHistory.push({ hours, effectiveDate });
    department.hoursHistory.sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
    await department.save();
    const employees = await Employee.find({ department: name });
    const holidays = await Holiday.find();
    for (const emp of employees) {
      emp.entries = await recalculateEmployeeEntries(emp, department, holidays);
      await emp.save();
    }
    res.json(department);
  } catch (error) {
    res.status(500).json({ error: 'Server error updating department hours' });
  }
});

app.get('/api/employees', async (req, res) => {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching employees' });
  }
});

app.post('/api/employees', async (req, res) => {
  const { name, baseSalary, startDate, department } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!name || !baseSalary || baseSalary < 1000 || !startDate || new Date(startDate) > new Date(currentDate) || !department || name.length > 50) {
    return res.status(400).json({ error: 'Invalid employee data' });
  }
  try {
    const existingEmp = await Employee.findOne({ name });
    if (existingEmp) return res.status(400).json({ error: 'Employee name must be unique' });
    const dept = await Department.findOne({ name: department });
    if (!dept) return res.status(400).json({ error: 'Department does not exist' });
    const employee = new Employee({
      name,
      baseSalary,
      startDate,
      department,
      salaryHistory: [{ salary: baseSalary, effectiveDate: startDate }],
      entries: [],
    });
    employee.entries = await recalculateEmployeeEntries(employee, dept, await Holiday.find());
    await employee.save();
    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({ error: 'Server error creating employee' });
  }
});

app.put('/api/employees/:name/department', async (req, res) => {
  const { name } = req.params;
  const { department } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!department) return res.status(400).json({ error: 'Department is required' });
  try {
    const employee = await Employee.findOne({ name });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (employee.department === department) return res.status(400).json({ error: 'Employee is already in this department' });
    const dept = await Department.findOne({ name: department });
    if (!dept) return res.status(400).json({ error: 'Department does not exist' });
    employee.department = department;
    employee.entries = await recalculateEmployeeEntries(employee, dept, await Holiday.find());
    await employee.save();
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: 'Server error transferring department' });
  }
});

app.put('/api/employees/:name/inactive', async (req, res) => {
  const { name } = req.params;
  const { endDate } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!endDate || new Date(endDate) > new Date(currentDate)) {
    return res.status(400).json({ error: 'Invalid end date' });
  }
  try {
    const employee = await Employee.findOne({ name });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (new Date(endDate) < new Date(employee.startDate)) return res.status(400).json({ error: 'End date must be after start date' });
    if (employee.endDate) return res.status(400).json({ error: 'Employee is already inactive' });
    employee.endDate = endDate;
    const dept = await Department.findOne({ name: employee.department });
    employee.entries = await recalculateEmployeeEntries(employee, dept, await Holiday.find());
    await employee.save();
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: 'Server error marking employee inactive' });
  }
});

app.put('/api/employees/:name/salary', async (req, res) => {
  const { name } = req.params;
  const { salary, effectiveDate } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!salary || salary < 1000 || !effectiveDate || new Date(effectiveDate) > new Date(currentDate)) {
    return res.status(400).json({ error: 'Invalid salary or effective date' });
  }
  try {
    const employee = await Employee.findOne({ name });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (employee.baseSalary === salary) return res.status(400).json({ error: 'New salary must be different from current salary' });
    employee.baseSalary = salary;
    employee.salaryHistory.push({ salary, effectiveDate });
    employee.salaryHistory.sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
    const dept = await Department.findOne({ name: employee.department });
    employee.entries = await recalculateEmployeeEntries(employee, dept, await Holiday.find());
    await employee.save();
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: 'Server error updating salary' });
  }
});

app.get('/api/holidays', async (req, res) => {
  try {
    const holidays = await Holiday.find();
    res.json(holidays);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching holidays' });
  }
});

app.post('/api/holidays', async (req, res) => {
  const { date } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!date || new Date(date) > new Date(currentDate)) {
    return res.status(400).json({ error: 'Invalid holiday date' });
  }
  try {
    const existingHoliday = await Holiday.findOne({ date });
    if (existingHoliday) return res.status(400).json({ error: 'Holiday already exists' });
    const holiday = new Holiday({ date });
    await holiday.save();
    const employees = await Employee.find();
    const departments = await Department.find();
    for (const emp of employees) {
      const dept = departments.find(d => d.name === emp.department);
      emp.entries = await recalculateEmployeeEntries(emp, dept, await Holiday.find());
      await emp.save();
    }
    res.status(201).json(holiday);
  } catch (error) {
    res.status(500).json({ error: 'Server error adding holiday' });
  }
});

app.post('/api/entries', async (req, res) => {
  const { empName, date, workType, startTime, endTime, hours } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!empName || !date || !workType || new Date(date) > new Date(currentDate)) {
    return res.status(400).json({ error: 'Invalid entry data' });
  }
  const holidays = await Holiday.find();
  if (holidays.some(h => h.date === date)) {
    return res.status(400).json({ error: 'Cannot add entry for a holiday' });
  }
  if (workType === 'CUSTOM' && (!startTime || !endTime)) {
    return res.status(400).json({ error: 'Start and end times are required for CUSTOM work type' });
  }
  if (workType === 'CUSTOM_HOURS' && (hours === undefined || hours < 0 || hours > 24)) {
    return res.status(400).json({ error: 'Hours must be between 0 and 24 for CUSTOM_HOURS work type' });
  }
  try {
    const employee = await Employee.findOne({ name: empName });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const dept = await Department.findOne({ name: employee.department });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleString('en-US', { weekday: 'long' });
    const salary = employee.salaryHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
      .find(h => new Date(h.effectiveDate) <= new Date(date))?.salary || employee.baseSalary;
    const deptHours = dept.hoursHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
      .find(h => new Date(h.effectiveDate) <= new Date(date))?.hours || dept.hours;
    const workingDays = getWorkingDaysInMonth(dateObj.getFullYear(), dateObj.getMonth(), holidays);
    const hourlyRate = salary / (deptHours * workingDays);

    let hoursWorked;
    let displayWorkType = workType;
    let hoursInput = hours || 0;
    if (workType === 'FULL_DAY') {
      hoursWorked = deptHours;
    } else if (workType === 'HALF_DAY') {
      hoursWorked = deptHours / 2;
    } else if (workType === 'CUSTOM') {
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      const [endHours, endMinutes] = endTime.split(':').map(Number);
      const start = new Date(0, 0, 0, startHours, startMinutes);
      const end = new Date(0, 0, 0, endHours, endMinutes);
      hoursWorked = (end - start) / (1000 * 60 * 60);
      displayWorkType = `${startTime}-${endTime}`;
    } else if (workType === 'CUSTOM_HOURS') {
      hoursWorked = hours;
      displayWorkType = `HOURS_${hours}`;
    } else {
      hoursWorked = 0;
    }

    const existingEntry = employee.entries.find(e => e.date === date);
    const entryId = existingEntry ? existingEntry.id : (employee.entries.length ? Math.max(...employee.entries.map(e => e.id)) + 1 : 0);

    if (existingEntry) {
      employee.entries = employee.entries.filter(e => e.date !== date);
    }
    employee.entries.push({
      id: entryId,
      date,
      hours: hoursWorked,
      pay: hoursWorked * hourlyRate,
      day: dayOfWeek,
      workType: displayWorkType,
      startTime,
      endTime,
      hoursWorked: hoursInput,
    });
    await employee.save();
    res.json(employee);
  } catch (error) {
    console.error('Error updating entry:', error);
    res.status(500).json({ error: 'Server error updating entry' });
  }
});

app.post('/api/entries/mass', async (req, res) => {
  const { department, date, hours } = req.body;
  const currentDate = new Date().toISOString().split('T')[0];
  if (!department || !date || new Date(date) > new Date(currentDate) || hours === undefined || hours < 0 || hours > 24) {
    return res.status(400).json({ error: 'Invalid department, date, or hours' });
  }
  const holidays = await Holiday.find();
  if (holidays.some(h => h.date === date)) {
    return res.status(400).json({ error: 'Cannot set hours for a holiday' });
  }
  try {
    const dept = await Department.findOne({ name: department });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const employees = await Employee.find({ 
      department, 
      startDate: { $lte: date }, 
      $or: [{ endDate: null }, { endDate: { $gte: date } }] 
    });
    if (employees.length === 0) return res.status(400).json({ error: 'No active employees in the department' });

    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleString('en-US', { weekday: 'long' });
    const regularDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!regularDays.includes(dayOfWeek)) return res.status(400).json({ error: 'Mass hours can only be set for regular working days' });

    const updatedEmployees = [];
    for (const employee of employees) {
      const salary = employee.salaryHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
        .find(h => new Date(h.effectiveDate) <= new Date(date))?.salary || employee.baseSalary;
      const deptHours = dept.hoursHistory.sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))
        .find(h => new Date(h.effectiveDate) <= new Date(date))?.hours || dept.hours;
      const workingDays = getWorkingDaysInMonth(dateObj.getFullYear(), dateObj.getMonth(), holidays);
      const hourlyRate = salary / (deptHours * workingDays);

      const existingEntry = employee.entries.find(e => e.date === date);
      const entryId = existingEntry ? existingEntry.id : (employee.entries.length ? Math.max(...employee.entries.map(e => e.id)) + 1 : 0);

      if (existingEntry) {
        employee.entries = employee.entries.filter(e => e.date !== date);
      }
      employee.entries.push({
        id: entryId,
        date,
        hours,
        pay: hours * hourlyRate,
        day: dayOfWeek,
        workType: `HOURS_${hours}`,
        startTime: '',
        endTime: '',
        hoursWorked: hours,
      });
      await employee.save();
      updatedEmployees.push(employee);
    }
    res.json(updatedEmployees);
  } catch (error) {
    console.error('Error updating mass hours:', error);
    res.status(500).json({ error: 'Server error updating mass hours' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});