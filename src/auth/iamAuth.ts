import axios from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import Auth from './auth';

const { AWS_REGION } = process.env;
export default class IamAuth implements Auth {
    // eslint-disable-next-line class-methods-use-this
    initialize(): void {
        const interceptor = aws4Interceptor({
            region: AWS_REGION,
            service: 'execute-api',
        });
        axios.interceptors.request.use(interceptor);
    }
}
