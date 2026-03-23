/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AppSettings from './pages/AppSettings';
import CalendarView from './pages/CalendarView';
import ChartDetail from './pages/ChartDetail';
import Charts from './pages/Charts';
import ClientDetail from './pages/ClientDetail';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import DocumentDetail from './pages/DocumentDetail';
import DrivingMode from './pages/DrivingMode';
import EmailInbox from './pages/EmailInbox';
import Equipment from './pages/Equipment';
import EstimateDetail from './pages/EstimateDetail';
import Estimates from './pages/Estimates';
import Finance from './pages/Finance';
import InvoiceDetail from './pages/InvoiceDetail';
import Invoices from './pages/Invoices';
import Practice from './pages/Practice';
import WorkEventDetail from './pages/WorkEventDetail';
import WorkEvents from './pages/WorkEvents';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AppSettings": AppSettings,
    "CalendarView": CalendarView,
    "ChartDetail": ChartDetail,
    "Charts": Charts,
    "ClientDetail": ClientDetail,
    "Clients": Clients,
    "Dashboard": Dashboard,
    "DocumentDetail": DocumentDetail,
    "DrivingMode": DrivingMode,
    "EmailInbox": EmailInbox,
    "Equipment": Equipment,
    "EstimateDetail": EstimateDetail,
    "Estimates": Estimates,
    "Finance": Finance,
    "InvoiceDetail": InvoiceDetail,
    "Invoices": Invoices,
    "Practice": Practice,
    "WorkEventDetail": WorkEventDetail,
    "WorkEvents": WorkEvents,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};