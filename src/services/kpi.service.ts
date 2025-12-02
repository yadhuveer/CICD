import { Contact } from "../models/Contacts.model.js";
//import { SignalNew } from "../models/newSignal.model.js";

export class KPIService {
  static async getKPIStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // New Contacts
    const newContacts = await Contact.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });

    // Contacts Found Today
    const contactsFoundToday = newContacts;

    // New Signals Today
    // const newSignalsToday = await SignalNew.countDocuments({
    //   createdAt: { $gte: todayStart, $lte: todayEnd },
    // });

    // High Priority = leadScore > 70
    const highPriority = await Contact.countDocuments({
      leadScore: { $gt: 70 },
    });

    // High-Quality Leads = leadScore > 70
    const highQualityLeads = highPriority;

    return {
      newContacts,
      contactsFoundToday,
      //newSignalsToday,
      highPriority,
      highQualityLeads,
    };
  }
}
