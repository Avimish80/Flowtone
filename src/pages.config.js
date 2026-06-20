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
// NOTE: this file was hand-edited for code-splitting (it is NOT actually
// auto-generated — there is no generator script in this repo). Pages are
// React.lazy()-loaded so they ship as separate chunks instead of bloating the
// initial bundle; App.jsx renders them inside a <Suspense> boundary. Dashboard
// (the landing page) and the Layout shell stay eager so the first paint after
// sign-in is instant with no loading flash. When adding a page, follow the
// lazy() pattern below.
import { lazy } from 'react';
import Dashboard from './pages/Dashboard';
import __Layout from './Layout.jsx';

const AppSettings = lazy(() => import('./pages/AppSettings'));
const CalendarView = lazy(() => import('./pages/CalendarView'));
const ChartDetail = lazy(() => import('./pages/ChartDetail'));
const Charts = lazy(() => import('./pages/Charts'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const Clients = lazy(() => import('./pages/Clients'));
const DocumentDetail = lazy(() => import('./pages/DocumentDetail'));
const DrivingMode = lazy(() => import('./pages/DrivingMode'));
const EmailInbox = lazy(() => import('./pages/EmailInbox'));
const Equipment = lazy(() => import('./pages/Equipment'));
const EstimateDetail = lazy(() => import('./pages/EstimateDetail'));
const Estimates = lazy(() => import('./pages/Estimates'));
const Finance = lazy(() => import('./pages/Finance'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Practice = lazy(() => import('./pages/Practice'));
const WorkEventDetail = lazy(() => import('./pages/WorkEventDetail'));
const Missions = lazy(() => import('./pages/Missions'));
const WorkEvents = lazy(() => import('./pages/WorkEvents'));


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
    "Missions": Missions,
    "Practice": Practice,
    "WorkEventDetail": WorkEventDetail,
    "WorkEvents": WorkEvents,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};