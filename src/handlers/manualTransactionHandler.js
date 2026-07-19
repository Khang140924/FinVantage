import { saveParsedInvoice } from "../services/db.service.js";
import * as response from "../utils/response.js";
import { requireAuth } from "../utils/cognitoAuth.js";

export const handler = async (event) => {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    try {
        const body =
            typeof event.body === "string"
                ? JSON.parse(event.body)
                : event.body;

        if (!body.description || !body.amount) {
            return response.badRequest("Thiếu nội dung hoặc số tiền.");
        }

        const invoice = await saveParsedInvoice({
            userId: auth.user.sub,
            storeName: body.description,
            totalAmount: Number(body.amount),
            category: body.category || "Khác",
            transactionDate: body.date,
            currency: "VND",
            status: "PAID",
            rawText: null,
            sourceFileKey: null,
            lineItems: [],
            aiAdvice: null
        });

        return response.success({
            message: "Thêm giao dịch thành công.",
            invoice
        });

    } catch (err) {
        return response.serverError(err.message);
    }
};