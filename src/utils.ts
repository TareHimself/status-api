export function buildResponse<
	E extends true | false,
	T extends E extends true ? string : any
>(data: T, error?: E) {
	return {
		data: data,
		error: error || false,
	};
}
