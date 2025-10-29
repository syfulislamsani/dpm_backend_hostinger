// order.service.ts
import {
	col,
	fn,
	literal,
	Op,
	Sequelize,
	Order as SequelizeOrder,
	WhereOptions,
} from "sequelize";
import UnlistedProduct from "../model/unlisted-product.model";
import OrderImage from "../model/order-image.model";
import OrderItem from "../model/order-item.model";
import Order, { OrderAttributes } from "../model/order.model";
import PaymentDetails from "../model/payment.model";
import ProductVariantDetail from "../model/product-variant-detail.model";
import ProductVariant from "../model/product-variant.model";
import Product, { ProductModelAttributes } from "../model/product.model";
import VariationItem from "../model/variation-item.model";
import Variation from "../model/variation.model";
import Staff from "../model/staff.model";
import CustomerService from "../service/customer.service";
import StaffService from "../service/staff.service";
import ProductCategory from "../model/product-category.model";
import ProductImage from "../model/product-image.model";

export type TopSellingProduct = Product & {
	dataValues: {
		totalQuantity: number;
	};
};

class OrderService {
	private staffService: StaffService;
	private customerService: CustomerService;
	constructor() {
		this.staffService = new StaffService();
		this.customerService = new CustomerService();
	}

	createOrder = async (
		// customerId: number | null,
		customerName: string,
		customerEmail: string,
		customerPhone: string,
		staffId: number | null,
		billingAddress: string,
		additionalNotes: string,
		deliveryMethod: "shop-pickup" | "courier",
		deliveryDate: Date | null,
		paymentMethod: "online-payment" | "cod-payment",
		paymentStatus: "pending" | "partial" | "paid",
		couponId: number | null,
		courierId: number | null,
		courierAddress: string | null,
		orderTotal: number,
		orderItems: {
			cartItemId: number;
			productId?: number;
			unlistedProductId?: number;
			product: ProductModelAttributes;
			productVariantId?: number;
			productVariant?: {
				productVariantId: number;
				productId: number;
				additionalPrice: number;
				variantDetails: {
					productVariationDetailId: number;
					productVariantId: number;
					variationItemId: number;
					variationItem: {
						value: string;
						// variation: {
						// 	name: string;
						// 	unit: string;
						// };
					};
				}[];
			};
			// Pricing breakdown (optional)
			unitPrice?: number | null;
			additionalPrice?: number | null;
			discountPercentage?: number | null;
			designCharge?: number | null;
			quantity: number;
			size: number | null;
			widthInch: number | null;
			heightInch: number | null;
			price: number;
		}[],
	): Promise<Order | OrderAttributes | null> => {
		try {
			const newOrder = {
				customerId: null,
				customerName,
				customerEmail,
				customerPhone,
				billingAddress,
				additionalNotes,
				staffId,
				deliveryMethod,
				paymentMethod,
				couponId,
				courierId,
				courierAddress,
				deliveryDate,
			};

			if (customerEmail) {
				const customer = await this.customerService.getCustomerByEmail(
					newOrder.customerEmail,
				);

				if (customer) {
					newOrder.customerId = customer.customerId as any;
					newOrder.customerName = customer.name;
					newOrder.customerEmail = customer.email;
					newOrder.customerPhone = customer.phone;
				} else {
					newOrder.customerId = null;
				}
			}

			if (!courierId || !courierAddress) {
				newOrder.courierId = null;
				newOrder.courierAddress = null;
			}

			// Random staff auto-assignment disabled by default.
			// To enable fair auto-assign when staffId is missing, flip the flag below.
			const ENABLE_FAIR_AUTO_ASSIGN = true; // fair auto-assign enabled
			if (ENABLE_FAIR_AUTO_ASSIGN && staffId == null) {
				// Exclude designers and offline-agents by selecting role 'agent' only
				const fair = await this.staffService.getFairRandomStaff({ preferOnline: true, role: "agent" });
				if (fair) newOrder.staffId = fair.staffId as any;
			}

			console.log("[OrderService.createOrder] creating order with staffId:", newOrder.staffId);
			const createdOrder = await Order.create({
				customerId: newOrder.customerId,
				customerName: newOrder.customerName,
				customerEmail: newOrder.customerEmail,
				customerPhone: newOrder.customerPhone,
				billingAddress: newOrder.billingAddress,
				additionalNotes: newOrder.additionalNotes,
				staffId: newOrder.staffId,
				method: "offline",
				status: "advance-payment-received",
				deliveryMethod: newOrder.deliveryMethod,
				paymentMethod: newOrder.paymentMethod,
				paymentStatus,
				couponId: newOrder.couponId,
				courierId: newOrder.courierId,
				courierAddress: newOrder.courierAddress,
				deliveryDate: newOrder.deliveryDate,
				currentStatus: "",
				orderTotalPrice: orderTotal,
				staffUpdateCount: 0,
			});


			if (orderItems.length > 0) {
				for (const orderItem of orderItems) {
					try {
						if (orderItem?.unlistedProductId) {
							// lets first create the unlisted product
							const unlistedProduct = await UnlistedProduct.create({
								name: orderItem.product.name,
								description: orderItem.product.description,
								basePrice: orderItem.product.basePrice,
								pricingType: orderItem.product.pricingType,
							});
							await OrderItem.create({
								orderId: createdOrder.orderId,
								unlistedProductId: unlistedProduct.unlistedProductId,
								unitPrice: (orderItem as any).unitPrice ?? null,
								additionalPrice: (orderItem as any).additionalPrice ?? null,
								discountPercentage: (orderItem as any).discountPercentage ?? null,
								designCharge: (orderItem as any).designCharge ?? null,
								quantity: orderItem.quantity,
								size: orderItem.size,
								widthInch: orderItem.widthInch,
								heightInch: orderItem.heightInch,
								price: orderItem.price,
							});
						} else {
							await OrderItem.create({
								orderId: createdOrder.orderId,
								productId: orderItem.productId,
								productVariantId: orderItem.productVariantId,
								unitPrice: (orderItem as any).unitPrice ?? null,
								additionalPrice: (orderItem as any).additionalPrice ?? null,
								discountPercentage: (orderItem as any).discountPercentage ?? null,
								designCharge: (orderItem as any).designCharge ?? null,
								quantity: orderItem.quantity,
								size: orderItem.size,
								widthInch: orderItem.widthInch,
								heightInch: orderItem.heightInch,
								price: orderItem.price,
							});
						}
					} catch (itemErr) {
						console.error("Error creating order item:", itemErr);
					}
				}
			}

			return (await this.getOrderById(createdOrder.orderId)) || null;
		} catch (err: any) {
			console.error("OrderService.createOrder error:", err);
			throw err;
		}
	};

	createOrderRequest = async (
		customerId: number | null,
		customerName: string,
		customerPhone: string,
		customerEmail: string | null,
		staffId: number | null,
		billingAddress: string,
		additionalNotes: string,
		deliveryMethod: "shop-pickup" | "courier",
		// paymentMethod: "online-payment" | "cod-payment",
		couponId: number | null,
		courierId: number | null,
		courierAddress: string | null,
		orderItems: {
			productId: number;
			productVariantId: number;
			// Pricing breakdown (optional)
			unitPrice?: number | null;
			additionalPrice?: number | null;
			discountPercentage?: number | null;
			designCharge?: number | null;
			quantity: number;
			size: number | null;
			widthInch: number | null;
			heightInch: number | null;
			price: number;
		}[],
	): Promise<Order | OrderAttributes | null> => {
		try {
			const newOrder = {
				customerId,
				customerName,
				customerPhone,
				customerEmail,
				billingAddress,
				additionalNotes,
				staffId,
				method: "online",
				status: "order-request-received",
				deliveryMethod,
				// paymentMethod,
				paymentStatus: "pending",
				couponId,
				courierId,
				courierAddress,
				deliveryDate: null,
				currentStatus: "",
			};

			// Do not force-fetch customer email; accept the provided email from the request.

			if (!courierId || !courierAddress) {
				newOrder.courierId = null;
				newOrder.courierAddress = null;
			}

			// Random staff auto-assignment disabled by default.
			// To enable fair auto-assign when staffId is missing, flip the flag below.
			const ENABLE_FAIR_AUTO_ASSIGN = true; // fair auto-assign enabled
			if (ENABLE_FAIR_AUTO_ASSIGN && staffId == null) {
				// Exclude designers and offline-agents by selecting role 'agent' only
				const fair = await this.staffService.getFairRandomStaff({ preferOnline: true, role: "agent" });
				if (fair) newOrder.staffId = fair.staffId as any;
			}

			console.log("[OrderService.createOrderRequest] creating order with staffId:", newOrder.staffId);
			const createdOrder = await Order.create({
				customerId: newOrder.customerId,
				customerName: newOrder.customerName,
				customerEmail: (newOrder as any).customerEmail,
				customerPhone: newOrder.customerPhone,
				billingAddress: newOrder.billingAddress,
				additionalNotes: newOrder.additionalNotes,
				staffId: newOrder.staffId,
				method: newOrder.method as any,
				status: newOrder.status as any,
				deliveryMethod: newOrder.deliveryMethod,
				// Set the intended payment method for requests to online-payment.
				paymentMethod: "online-payment",
				paymentStatus: newOrder.paymentStatus as any,
				couponId: newOrder.couponId,
				courierId: newOrder.courierId,
				courierAddress: newOrder.courierAddress,
				deliveryDate: newOrder.deliveryDate,
				currentStatus: newOrder.currentStatus,
				orderTotalPrice: orderItems.reduce((acc, curr) => {
					return acc + curr.price;
				}, 0),
				staffUpdateCount: 0,
			});

			if (orderItems.length > 0) {
				await OrderItem.bulkCreate(
					orderItems.map((orderItem) => ({
						orderId: createdOrder.orderId,
						productId: orderItem.productId,
						productVariantId: orderItem.productVariantId,
						unitPrice: (orderItem as any).unitPrice ?? null,
						additionalPrice: (orderItem as any).additionalPrice ?? null,
						discountPercentage: (orderItem as any).discountPercentage ?? null,
						designCharge: (orderItem as any).designCharge ?? null,
						quantity: orderItem.quantity,
						size: orderItem.size,
						widthInch: orderItem.widthInch,
						heightInch: orderItem.heightInch,
						price: orderItem.price,
					}))
				);
			}

			// const createdOrder = await this.getOrderById(newOrder.orderId);
			return (await this.getOrderById(createdOrder.orderId)) || null;
		} catch (err: any) {
			
			throw err;
		}
	};

	getOrderById = async (
		orderId: number,
	): Promise<Order | OrderAttributes | null> => {
		try {
			const order = await Order.findByPk(orderId, {
				include: [
					{
						model: OrderItem,
						as: "orderItems",
						separate: true,
						include: [
							{
								model: Product,
								as: "product",
								attributes: [
									"productId",
									"name",
									"basePrice",
									"sku",
								],
							},
							{
								model: UnlistedProduct,
								as: "unlistedProduct",
							},
							{
								model: ProductVariant,
								as: "productVariant",
								attributes: [
									"productVariantId",
									"productId",
									"additionalPrice",
								],
								include: [
									{
										model: ProductVariantDetail,
										as: "variantDetails",
										attributes: [
											"productVariantDetailId",
											"productVariantId",
											"variationItemId",
										],
										separate: true,
										include: [
											{
												model: VariationItem,
												attributes: ["value"],
												include: [
													{
														model: Variation,
														as: "variation",
														attributes: [
															"name",
															"unit",
														],
													},
												],
											},
										],
									},
								],
							},
						],
					},
					{ model: OrderImage, as: "images", separate: true },
					{ model: PaymentDetails, as: "payments", separate: true },
					{ model: Staff, as: "staff" },
				],
			});

			return order ? order.toJSON() : null;
		} catch (err: any) {
			
			throw err;
		}
	};

	getOrdersByCustomer = async (
		customerId: number,
	): Promise<Order[] | OrderAttributes[] | null> => {
		try {
			const orders = await Order.findAll({
				where: { customerId },
				include: [
					{
						model: OrderItem,
						as: "orderItems",
						separate: true,
						include: [
							{
								model: Product,
								as: "product",
								attributes: [
									"productId",
									"name",
									"basePrice",
									"sku",
								],
							},
							{
								model: ProductVariant,
								as: "productVariant",
								attributes: [
									"productVariantId",
									"productId",
									"additionalPrice",
								],
								include: [
									{
										model: ProductVariantDetail,
										as: "variantDetails",
										attributes: [
											"productVariantDetailId",
											"productVariantId",
											"variationItemId",
										],
										separate: true,
										include: [
											{
												model: VariationItem,
												attributes: ["value"],
												include: [
													{
														model: Variation,
														as: "variation",
														attributes: [
															"name",
															"unit",
														],
													},
												],
											},
										],
									},
								],
							},
						],
					},
					{ model: OrderImage, as: "images", separate: true },
					{
						model: PaymentDetails,
						as: "payments",
						separate: true,
					},
				],
			});

			return orders ? orders.map((order) => order.toJSON()) : null;
		} catch (err: any) {
			
			throw err;
		}
	};

	addOrderImage = async (
		imageName: string,
		orderId: number,
	): Promise<boolean> => {
		try {
			await OrderImage.create({ imageName, orderId });
			return true;
		} catch (err: any) {
			
			throw err;
		}
	};

	updateOrder = async (
		orderId: number,
		deliveryDate: Date | null,
		status:
			| "order-request-received"
			| "consultation-in-progress"
			| "order-canceled"
			| "awaiting-advance-payment"
			| "advance-payment-received"
			| "design-in-progress"
			| "awaiting-design-approval"
			| "production-started"
			| "production-in-progress"
			| "ready-for-delivery"
			| "out-for-delivery"
			| "order-completed",
		courierAddress: string | null,
		additionalNotes: string,
		newStaffUpdateCount?: number,
	): Promise<boolean> => {
		try {
			const updateFields: any = {
				deliveryDate,
				status,
				courierAddress,
				additionalNotes,
			};

			// Conditionally add staffUpdateCount to the update object if provided.
			if (newStaffUpdateCount !== undefined) {
				updateFields.staffUpdateCount = newStaffUpdateCount;
			}

			console.log('[OrderService.updateOrder] checking order existence before update', { orderId });
			const existing = await Order.findByPk(orderId);
			if (!existing) {
				console.warn('[OrderService.updateOrder] order not found for update', { orderId });
				return false;
			}

			// Log the existing DB row so we can compare incoming payload vs stored values
			console.log('[OrderService.updateOrder] existing order before update', existing.toJSON());
			console.log('[OrderService.updateOrder] updating order', { orderId, updateFields });
			const [affectedRows] = await Order.update(updateFields, {
				where: { orderId },
			});
			console.log('[OrderService.updateOrder] update affectedRows', { orderId, affectedRows });

			// Fetch the order again to verify current DB state after update attempt
			const after = await Order.findByPk(orderId);
			console.log('[OrderService.updateOrder] order after update', after ? after.toJSON() : null);

			// If the order exists but affectedRows is 0, it likely means the update did not change values
			// (e.g., status remained the same). Treat that as success rather than failure.
			return true;
		} catch (err: any) {
			console.error('[OrderService.updateOrder] ERROR', err);
			throw err;
		}
	};

	// Documentation: New method to reset the staff update count for an order, typically called by admin.
	resetStaffUpdateCount = async (orderId: number): Promise<boolean> => {
		try {
			const [affectedRows] = await Order.update(
				{ staffUpdateCount: 0 },
				{ where: { orderId } },
			);
			return affectedRows > 0;
		} catch (err: any) {
			console.error('[OrderService.resetStaffUpdateCount] ERROR', err);
			throw err;
		}

	};

	updateOrderPaymentStatus = async (
		orderId: number,
		paymentStatus: "pending" | "partial" | "paid",
	): Promise<boolean> => {
		try {
			console.log('[OrderService.updateOrderPaymentStatus] updating paymentStatus', { orderId, paymentStatus });
			const result = await Order.update(
				{ paymentStatus },
				{ where: { orderId } },
			);
			console.log('[OrderService.updateOrderPaymentStatus] update result', { orderId, result });
			if (!result) return false;
			return true;
		} catch (err: any) {
			
			throw err;
		}
	};

	deleteOrder = async (orderId: number): Promise<boolean> => {
		try {
			const order = await this.getOrderById(orderId);

			if (!order) {
				return false;
			}

			// first delete order items
			if (order.orderItems.length > 0) {
				await Promise.all(
					order.orderItems.map(async (orderItem) => {
						await OrderItem.destroy({
							where: {
								orderItemId: orderItem.orderItemId,
							},
						});
					}),
				);
			}

			// then remove order images
			if (order.images.length > 0) {
				await Promise.all(
					order.images.map(async (image) => {
						await OrderImage.destroy({
							where: {
								imageId: image.imageId,
							},
						});
					}),
				);
			}

			// finally, delete the order
			await Order.destroy({
				where: {
					orderId,
				},
			});

			return true;
		} catch (err: any) {
			
			throw err;
		}
	};

	getOrderStats = async () => {
		try {
			const monthlyOrders = await Order.findAll({
				attributes: [
					[
						Sequelize.fn(
							"DATE_FORMAT",
							Sequelize.col("createdAt"),
							"%m-%Y",
						),
						"month",
					],
					[Sequelize.fn("COUNT", Sequelize.col("orderId")), "count"],
				],
				where: {
					status: {
						[Op.not]: "order-canceled",
					},
					createdAt: {
						[Op.gte]: Sequelize.literal(
							"DATE_SUB(CURDATE(), INTERVAL 12 MONTH)",
						), // Last 12 months
					},
				},
				group: ["month"],
				order: [["month", "ASC"]],
			});

			const formattedData = monthlyOrders.map((item: any) => ({
				month: item.get("month"),
				count: parseInt(item.get("count")),
			}));

			return formattedData;
		} catch (err: any) {
			
			throw err;
		}
	};

	getRecentOrders = async () => {
		try {
			const orders = await Order.findAll({
				limit: 10,
				order: [["createdAt", "DESC"]],
				include: [
					{
						model: OrderItem,
						as: "orderItems",
						separate: true,
						include: [
							{
								model: Product,
								as: "product",
								attributes: [
									"productId",
									"name",
									"basePrice",
									"sku",
								],
							},
							{
								model: UnlistedProduct,
								as: "unlistedProduct",
							},
						],
					},
				],
			});
			return orders ? orders.map((order) => order.toJSON()) : null;
		} catch (err: any) {
			
			throw err;
		}
	};

	getTopSellingProducts = async () => {
		try {
			const limit = 10;

			const topSellersAggregated = await OrderItem.findAll({
				attributes: [
					"productId",
					[
						Sequelize.fn("SUM", Sequelize.col("quantity")),
						"totalQuantity",
					],
					[
						Sequelize.fn("SUM", Sequelize.col("price")),
						"totalRevenue",
					],
				],
				include: [
					{
						model: Order,
						attributes: [], // We don't need any data from Order, just use it for filtering
						where: { status: "order-completed" }, // CRITICAL: Only count completed orders
						required: true, // This makes it an INNER JOIN
					},
				],
				where: {
					productId: { [Op.ne]: null }, // Only count items that are actual products
				},
				group: ["productId"], // Group by the product ID to SUM correctly
				order: [[Sequelize.literal("totalQuantity"), "DESC"]],
				limit: limit,
				raw: true, // `raw: true` is perfect here because we don't need nested models
			});

			// If no products were sold, return an empty array.
			if (topSellersAggregated.length === 0) {
				return [];
			}

			// Extract just the product IDs from the first query
			const topProductIds = topSellersAggregated.map(
				(item: any) => item.productId,
			);

			const topProductsData = await Product.findAll({
				where: {
					productId: {
						[Op.in]: topProductIds,
					},
				},
				include: [
					{
						model: ProductImage,
						as: "images",
						attributes: ["imageName"],
					},
					{
						model: ProductCategory,
						as: "category",
						attributes: ["categoryId", "name"], // specify attributes you need
					},
					// Add any other related models you want here
					// { model: ProductTag, as: 'tags' },
				],
			});

			// Create a lookup map for quick access to totals
			const totalsMap = new Map<
				number,
				{ totalQuantity: string; totalRevenue: string }
			>();
			topSellersAggregated.forEach((item: any) => {
				totalsMap.set(item.productId, {
					totalQuantity: item.totalQuantity,
					totalRevenue: item.totalRevenue,
				});
			});

			// Map over the full product data and merge in the totals
			const formattedData = topProductsData.map((product) => {
				const totals = totalsMap.get(product.productId);
				return {
					product: product.toJSON(), // .toJSON() gives a clean object of the product and its includes
					totalQuantity: totals
						? parseInt(totals.totalQuantity, 10)
						: 0,
					totalRevenue: totals ? parseFloat(totals.totalRevenue) : 0,
				};
			});

			// Sort the final array according to the original order (by totalQuantity)
			formattedData.sort((a, b) => b.totalQuantity - a.totalQuantity);

			return formattedData;
		} catch (err: any) {
			
			throw err;
		}
	};

	getTopellingProducts = async (
		year: number,
		month: number,
		limit: number = 10,
	): Promise<TopSellingProduct[]> => {
		// 1. Calculate the start and end dates for the given month
		// The month in JS Date is 0-indexed (0-11), so we subtract 1.
		const startDate = new Date(2025, 5, 1);
		// Getting the last day of the month by going to the next month's 0th day
		const endDate = Date.now();

		// 2. Build and execute the Sequelize query
		const topProducts = await Product.findAll({
			attributes: {
				// Include all columns from the Product table
				include: [
					// Define a new virtual attribute 'totalQuantity' using SQL SUM function
					[fn("SUM", col("orderItems.quantity")), "totalQuantity"],
				],
			},
			include: [
				{
					model: OrderItem,
					as: "orderItems", // Ensure you have this alias in your Product model if you defined one
					attributes: [], // We don't need any columns from OrderItem itself in the final result
					required: true, // This makes it an INNER JOIN
					where: {
						createdAt: {
							[Op.between]: [startDate, endDate],
						},
						// Ensure we only count items linked to a product
						productId: { [Op.ne]: null },
					},
				},
				// Eager load related data for the final product list if needed
				{ model: ProductCategory, as: "category" },
				{ model: ProductImage, as: "images", limit: 1 }, // Get just the main image
			],
			group: ["Product.productId"], // Group results by product ID to sum quantities correctly
			order: [
				// Order by our new virtual attribute 'totalQuantity' in descending order
				[literal("totalQuantity"), "DESC"],
			],
			limit: limit,
			// IMPORTANT: subQuery: false is crucial for LIMIT to work correctly with grouped includes
			subQuery: false,
		});

		// The result type needs to be cast because 'totalQuantity' is a dynamic property
		return topProducts as TopSellingProduct[];
	};

	// Documentation: Modified method to ensure designers see all orders, admins see all orders, and agents see only their own orders.
	// The `staffId` filter is preserved for agents but removed for admins and designers to allow access to all orders.
	getAllOrders = async (
		filter: WhereOptions<OrderAttributes>,
		limit: number,
		offset: number,
		order: SequelizeOrder,
		requesterRole?: string,
	): Promise<{
		rows: Order[] | OrderAttributes[];
		count: number;
	}> => {
		try {
			// 🏪 SERVICE ENTRY DEBUG - You can add logging here if needed

			// Documentation: Initialize the final filter by copying the provided filter
			let finalFilter: WhereOptions<OrderAttributes> = { ...filter };

			// RBAC Implementation in Service Layer:
			// - Admin & Designer: Remove staffId filter to see all orders
			// - Agent: Keep staffId filter to see only their orders
			if (requesterRole === "admin" || requesterRole === "designer") {
				// Remove staffId filter for admin and designer
				const { staffId, ...restFilter } = filter as {
					staffId?: any;
					[key: string]: any;
				};
				finalFilter = restFilter;
			} else {
				// For agents/offline-agents, keep the filter as is (including staffId if present)
				finalFilter = { ...filter };
			}

			// Use appropriate model based on role
			const orderModel =
				requesterRole === "admin" || requesterRole === "designer"
					? Order.unscoped() // Admin/Designer: Use unscoped to see all orders
					: Order; // Agent: Use scoped model

			const orders = await orderModel.findAll({
				where: finalFilter, // Use the finalFilter to apply to the query
				limit,
				offset,
				order,
				subQuery: false,
				include: [
					{
						model: OrderItem,
						as: "orderItems",
						separate: true,
						include: [
							{
								model: Product,
								as: "product",
								attributes: [
									"productId",
									"name",
									"basePrice",
									"sku",
								],
							},
							{
								model: UnlistedProduct,
								as: "unlistedProduct",
							},
							{
								model: ProductVariant,
								as: "productVariant",
								attributes: [
									"productVariantId",
									"productId",
									"additionalPrice",
								],
								include: [
									{
										model: ProductVariantDetail,
										as: "variantDetails",
										attributes: [
											"productVariantDetailId",
											"productVariantId",
											"variationItemId",
										],
										separate: true,
										include: [
											{
												model: VariationItem,
												attributes: ["value"],
												include: [
													{
														model: Variation,
														as: "variation",
														attributes: [
															"name",
															"unit",
														],
													},
												],
											},
										],
									},
								],
							},
						],
					},
					{ model: OrderImage, as: "images", separate: true },
					{ model: PaymentDetails, as: "payments", separate: true },
				],
			});

			// Get total count separately using the same final filter
			// Use the same model for count as for the main query
			const count = await orderModel.count({ where: finalFilter });

			return {
				rows: orders.map((order) => order.toJSON()),
				count,
			};
		} catch (err: any) {
			
			throw err;
		}
	};
}

export default OrderService;
